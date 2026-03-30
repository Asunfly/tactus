export class InternalCDPRelayRuntime {
  constructor(input) {
    this.waitForExtensionConnection = input.waitForExtensionConnection;
    this.callExtension = input.callExtension;
    this.sendToPlaywright = input.sendToPlaywright;
    this.targetsByTargetId = new Map();
    this.targetIdBySessionId = new Map();
    this.currentTargetId = null;
    this.nextSessionId = 1;
    this.defaultBrowserContextId = 'tactus-default-context';
  }

  resetBrowserSession() {
    this.targetsByTargetId.clear();
    this.targetIdBySessionId.clear();
    this.currentTargetId = null;
  }

  debug(...args) {
    if (process.env.TACTUS_PLAYWRIGHT_DEBUG === '1') {
      console.log('[tactus-relay]', ...args);
    }
  }

  async handleExtensionMessage(method, params) {
    this.debug('extension->relay', method, params?.method || '');
    if (method === 'tabReattached') {
      this.handleTabReattached(params);
      return;
    }
    if (method !== 'forwardCDPEvent') {
      return;
    }

    const target = this.resolveTargetByTabId(params?.tabId)
      || (this.currentTargetId ? this.targetsByTargetId.get(this.currentTargetId) : null);
    this.sendToPlaywright({
      method: params.method,
      sessionId: params.sessionId || target?.sessionId,
      params: params.params,
    });
  }

  async handlePlaywrightMessage(message) {
    const { method, params, sessionId } = message;
    this.debug('playwright->relay', method, sessionId || '', params?.targetId || '');

    switch (method) {
      case 'Browser.getVersion':
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Tactus-Bridge',
          userAgent: 'Tactus-Bridge-Server/1.0.0',
        };
      case 'Browser.setDownloadBehavior':
        return {};
      case 'Target.setAutoAttach': {
        if (sessionId) {
          return {};
        }
        await this.waitForExtensionConnection();
        const attached = await this.callExtension('attachToTab', {});
        this.upsertTarget(attached, {
          emitAttachedEvent: true,
          emitCreatedEvent: false,
          setCurrent: true,
        });
        return {};
      }
      case 'Target.getTargetInfo': {
        const targetId = params?.targetId || this.currentTargetId;
        const target = targetId ? this.targetsByTargetId.get(targetId) : null;
        return {
          targetInfo: target?.targetInfo,
        };
      }
      case 'Target.createTarget': {
        await this.waitForExtensionConnection();
        const created = await this.callExtension('createTab', {
          url: params?.url || 'about:blank',
          active: true,
        });
        const target = this.upsertTarget(created, {
          emitAttachedEvent: true,
          emitCreatedEvent: true,
          emitInfoChangedEvent: true,
          deferLifecycleEvents: true,
          setCurrent: true,
        });
        return {
          targetId: target.targetInfo.targetId,
        };
      }
      case 'Target.closeTarget': {
        const target = this.resolveTarget(sessionId, params?.targetId);
        if (!target) {
          throw new Error(`Unknown target: ${params?.targetId || sessionId}`);
        }
        await this.callExtension('closeTab', { tabId: target.tabId });
        this.targetsByTargetId.delete(target.targetInfo.targetId);
        this.targetIdBySessionId.delete(target.sessionId);
        if (this.currentTargetId === target.targetInfo.targetId) {
          this.currentTargetId = this.targetsByTargetId.keys().next().value ?? null;
        }
        this.sendToPlaywright({
          method: 'Target.detachedFromTarget',
          params: {
            sessionId: target.sessionId,
            targetId: target.targetInfo.targetId,
          },
        });
        return { success: true };
      }
      case 'Target.activateTarget': {
        const target = this.resolveTarget(sessionId, params?.targetId);
        if (!target) {
          throw new Error(`Unknown target: ${params?.targetId || sessionId}`);
        }
        const rebound = await this.callExtension('bindToTab', {
          tabId: target.tabId,
          emitLifecycleEvent: false,
        });
        this.upsertTarget(rebound, {
          emitAttachedEvent: false,
          emitCreatedEvent: false,
          setCurrent: true,
          preferredSessionId: target.sessionId,
        });
        return {};
      }
      default:
        return await this.forwardToExtension(method, params, sessionId);
    }
  }

  async forwardToExtension(method, params, sessionId) {
    await this.waitForExtensionConnection();
    const target = this.resolveTarget(sessionId, params?.targetId);

    return await this.callExtension('forwardCDPCommand', {
      tabId: target?.tabId,
      sessionId: undefined,
      method,
      params,
    });
  }

  handleTabReattached(params) {
    this.upsertTarget(params, {
      emitAttachedEvent: true,
      emitCreatedEvent: true,
      setCurrent: true,
    });
  }

  resolveTarget(sessionId, explicitTargetId) {
    if (explicitTargetId && this.targetsByTargetId.has(explicitTargetId)) {
      return this.targetsByTargetId.get(explicitTargetId);
    }
    if (sessionId && this.targetIdBySessionId.has(sessionId)) {
      return this.targetsByTargetId.get(this.targetIdBySessionId.get(sessionId));
    }
    if (this.currentTargetId) {
      return this.targetsByTargetId.get(this.currentTargetId);
    }
    return null;
  }

  resolveTargetByTabId(tabId) {
    if (typeof tabId !== 'number') {
      return null;
    }
    for (const target of this.targetsByTargetId.values()) {
      if (target.tabId === tabId) {
        return target;
      }
    }
    return null;
  }

  upsertTarget(payload, options = {}) {
    const rawTargetInfo = payload?.targetInfo ?? payload;
    const targetInfo = this.normalizeTargetInfo(rawTargetInfo);
    if (!targetInfo?.targetId) {
      throw new Error('Missing targetInfo.targetId from extension bridge');
    }

    const existing = this.targetsByTargetId.get(targetInfo.targetId);
    const sessionId = options.preferredSessionId
      || existing?.sessionId
      || `tactus-tab-${this.nextSessionId++}`;

    const target = {
      tabId: payload?.tabId ?? existing?.tabId,
      targetInfo,
      sessionId,
    };

    this.targetsByTargetId.set(targetInfo.targetId, target);
    this.targetIdBySessionId.set(sessionId, targetInfo.targetId);
    if (options.setCurrent !== false) {
      this.currentTargetId = targetInfo.targetId;
    }

    const dispatchLifecycleEvents = () => {
      if (options.emitCreatedEvent && !existing) {
        this.sendToPlaywright({
          method: 'Target.targetCreated',
          params: {
            targetInfo,
          },
        });
      }

      if (options.emitInfoChangedEvent) {
        this.sendToPlaywright({
          method: 'Target.targetInfoChanged',
          params: {
            targetInfo,
          },
        });
      }

      if (options.emitAttachedEvent && (!existing || options.forceAttachedEvent)) {
        this.sendToPlaywright({
          method: 'Target.attachedToTarget',
          params: {
            sessionId,
            targetInfo: {
              ...targetInfo,
              attached: true,
            },
            waitingForDebugger: false,
          },
        });
      }
    };

    if (options.deferLifecycleEvents) {
      setTimeout(dispatchLifecycleEvents, 0);
    } else {
      dispatchLifecycleEvents();
    }

    return target;
  }

  normalizeTargetInfo(targetInfo) {
    if (!targetInfo) {
      return targetInfo;
    }

    return {
      browserContextId: this.defaultBrowserContextId,
      type: 'page',
      title: '',
      url: 'about:blank',
      ...targetInfo,
    };
  }
}
