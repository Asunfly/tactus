import type { InternalPlaywrightBridgeBindMessage } from './internalPlaywrightBridge';

interface BridgeTabLike {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
  title?: string;
}

export interface BridgeSocketLike {
  readyState: number;
  onopen: ((event?: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onclose: ((event?: any) => void) | null;
  onerror: ((event?: any) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BridgeDebuggerApi {
  attach(debuggee: { tabId: number }, version: string): Promise<void>;
  sendCommand(
    debuggee: { tabId: number; sessionId?: string },
    method: string,
    params?: any,
  ): Promise<any>;
  detach(debuggee: { tabId: number }): Promise<void>;
  onEvent: {
    addListener(listener: (source: { tabId?: number; sessionId?: string }, method: string, params: any) => void): void;
    removeListener(listener: (source: { tabId?: number; sessionId?: string }, method: string, params: any) => void): void;
  };
  onDetach: {
    addListener(listener: (source: { tabId?: number }, reason: string) => void): void;
    removeListener(listener: (source: { tabId?: number }, reason: string) => void): void;
  };
}

export interface BridgeTabsApi {
  create(createProperties: { url?: string; active?: boolean }): Promise<BridgeTabLike>;
  get(tabId: number): Promise<BridgeTabLike>;
  remove(tabId: number): Promise<void>;
  query(queryInfo: Record<string, any>): Promise<BridgeTabLike[]>;
}

interface TabBindingState {
  tabId: number;
  attached: boolean;
  dialogOpen: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface ConnectionState {
  extensionEndpoint: string;
  socket: BridgeSocketLike;
  openPromise: Promise<void>;
  defaultTabId: number;
  tabsById: Map<number, TabBindingState>;
}

export class InternalPlaywrightBridgeBackground {
  private readonly createSocket: (url: string) => BridgeSocketLike;
  private readonly debuggerApi: BridgeDebuggerApi;
  private readonly tabsApi: BridgeTabsApi;
  private readonly idleTimeoutMs: number;
  private currentConnection: ConnectionState | null = null;
  private disposed = false;

  private readonly handleDebuggerEvent = (
    source: { tabId?: number; sessionId?: string },
    method: string,
    params: any,
  ) => {
    const connection = this.currentConnection;
    if (!connection || typeof source.tabId !== 'number') return;
    const tabState = connection.tabsById.get(source.tabId);
    if (!tabState || connection.socket.readyState !== 1) return;
    if (method === 'Inspector.detached') {
      tabState.attached = false;
      this.clearTabIdleTimer(tabState);
      return;
    }

    if (method === 'Page.javascriptDialogOpening') {
      tabState.dialogOpen = true;
    } else if (method === 'Page.javascriptDialogClosed') {
      tabState.dialogOpen = false;
    }

    this.touchTabActivity(connection, tabState);
    connection.socket.send(JSON.stringify({
      method: 'forwardCDPEvent',
      params: {
        tabId: source.tabId,
        sessionId: source.sessionId,
        method,
        params,
      },
    }));
  };

  private readonly handleDebuggerDetach = (source: { tabId?: number }, _reason: string) => {
    const connection = this.currentConnection;
    if (!connection || typeof source.tabId !== 'number') return;
    const tabState = connection.tabsById.get(source.tabId);
    if (!tabState) return;
    tabState.attached = false;
    tabState.dialogOpen = false;
    this.clearTabIdleTimer(tabState);
  };

  constructor(input: {
    createSocket: (url: string) => BridgeSocketLike;
    debuggerApi: BridgeDebuggerApi;
    tabsApi: BridgeTabsApi;
    idleTimeoutMs?: number;
  }) {
    this.createSocket = input.createSocket;
    this.debuggerApi = input.debuggerApi;
    this.tabsApi = input.tabsApi;
    this.idleTimeoutMs = input.idleTimeoutMs ?? 30_000;
    this.debuggerApi.onEvent.addListener(this.handleDebuggerEvent);
    this.debuggerApi.onDetach.addListener(this.handleDebuggerDetach);
  }

  async ensureBinding(message: InternalPlaywrightBridgeBindMessage): Promise<void> {
    if (this.disposed) {
      throw new Error('Internal Playwright bridge has been disposed');
    }

    if (
      this.currentConnection
      && this.currentConnection.extensionEndpoint === message.extensionEndpoint
      && this.currentConnection.socket.readyState !== 3
    ) {
      this.currentConnection.defaultTabId = message.tabId;
      this.getOrCreateTabState(this.currentConnection, message.tabId);
      await this.currentConnection.openPromise;
      return;
    }

    await this.teardownCurrentConnection('Rebinding internal Playwright bridge');

    const socket = this.createSocket(message.extensionEndpoint);
    const openPromise = new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('Failed to connect internal Playwright bridge'));
    });

    const connection: ConnectionState = {
      extensionEndpoint: message.extensionEndpoint,
      socket,
      openPromise,
      defaultTabId: message.tabId,
      tabsById: new Map(),
    };

    this.getOrCreateTabState(connection, message.tabId);

    socket.onmessage = (event) => {
      void this.handleSocketMessage(connection, event.data);
    };
    socket.onclose = () => {
      if (this.currentConnection !== connection) return;
      void this.teardownCurrentConnection('Internal Playwright bridge socket closed');
    };

    this.currentConnection = connection;
    await openPromise;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.teardownCurrentConnection('Internal Playwright bridge disposed');
    this.debuggerApi.onEvent.removeListener(this.handleDebuggerEvent);
    this.debuggerApi.onDetach.removeListener(this.handleDebuggerDetach);
  }

  private async handleSocketMessage(connection: ConnectionState, rawData: string): Promise<void> {
    let message: { id?: number; method?: string; params?: any };
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }

    if (!message.id || !message.method) return;

    const response: { id: number; result?: any; error?: string } = { id: message.id };

    try {
      if (message.method === 'attachToTab') {
        const tabId = this.resolveTabId(connection, message.params?.tabId);
        const tabState = await this.ensureDebuggerAttached(connection, tabId);
        const targetInfo = await this.getCurrentTargetInfo(tabState.tabId);
        response.result = {
          tabId: tabState.tabId,
          targetInfo: targetInfo?.targetInfo ?? targetInfo,
        };
      } else if (message.method === 'bindToTab') {
        const nextTabId = Number(message.params?.tabId);
        if (!nextTabId) {
          throw new Error('bindToTab requires a valid tabId');
        }
        connection.defaultTabId = nextTabId;
        const tabState = await this.ensureDebuggerAttached(connection, nextTabId);
        const targetInfo = await this.getCurrentTargetInfo(tabState.tabId);
        if (Boolean(message.params?.emitLifecycleEvent) && connection.socket.readyState === 1) {
          connection.socket.send(JSON.stringify({
            method: 'tabReattached',
            params: {
              tabId: nextTabId,
              targetInfo: targetInfo?.targetInfo ?? targetInfo,
            },
          }));
        }
        response.result = {
          tabId: nextTabId,
          targetInfo: targetInfo?.targetInfo ?? targetInfo,
        };
      } else if (message.method === 'createTab') {
        const createdTab = await this.tabsApi.create({
          url: message.params?.url,
          active: message.params?.active ?? true,
        });
        if (!createdTab?.id) {
          throw new Error('Failed to create browser tab');
        }
        connection.defaultTabId = createdTab.id;
        const tabState = await this.ensureDebuggerAttached(connection, createdTab.id);
        const targetInfo = await this.getCurrentTargetInfo(tabState.tabId);
        response.result = {
          tabId: createdTab.id,
          targetInfo: targetInfo?.targetInfo ?? targetInfo,
        };
      } else if (message.method === 'closeTab') {
        const tabId = Number(message.params?.tabId);
        if (!tabId) {
          throw new Error('closeTab requires a valid tabId');
        }
        await this.closeTab(connection, tabId);
        response.result = { success: true };
      } else if (message.method === 'forwardCDPCommand') {
        const { tabId, sessionId, method, params } = message.params || {};
        const resolvedTabId = this.resolveTabId(connection, tabId);
        const tabState = await this.ensureDebuggerAttached(connection, resolvedTabId);

        if (method === 'Page.handleJavaScriptDialog' && !tabState.dialogOpen) {
          response.result = {};
        } else {
          try {
            response.result = await this.debuggerApi.sendCommand(
              sessionId ? { tabId: tabState.tabId, sessionId } : { tabId: tabState.tabId },
              method,
              params,
            );
            console.debug('[tactus-bridge] forwardCDPCommand ok', tabState.tabId, method);
            if (method === 'Page.handleJavaScriptDialog') {
              tabState.dialogOpen = false;
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.debug('[tactus-bridge] forwardCDPCommand error', method, errorMessage);
            if (errorMessage.includes('Debugger is not attached to the tab with id:')) {
              tabState.attached = false;
              await this.ensureDebuggerAttached(connection, tabState.tabId);
              response.result = await this.debuggerApi.sendCommand(
                sessionId ? { tabId: tabState.tabId, sessionId } : { tabId: tabState.tabId },
                method,
                params,
              );
              console.debug('[tactus-bridge] forwardCDPCommand retry-ok', tabState.tabId, method);
              if (method === 'Page.handleJavaScriptDialog') {
                tabState.dialogOpen = false;
              }
            } else if (
              errorMessage.includes('Cannot find context with specified id')
              && (method === 'Runtime.callFunctionOn' || method === 'Runtime.evaluate')
            ) {
              response.result = {
                result: {
                  type: 'undefined',
                },
              };
            } else {
              throw error;
            }
          }
        }

        this.touchTabActivity(connection, tabState);
      } else {
        response.error = `Unsupported bridge command: ${message.method}`;
      }
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }

    if (connection.socket.readyState === 1) {
      connection.socket.send(JSON.stringify(response));
    }
  }

  private async teardownCurrentConnection(reason: string): Promise<void> {
    const connection = this.currentConnection;
    if (!connection) return;

    this.currentConnection = null;

    for (const tabState of connection.tabsById.values()) {
      this.clearTabIdleTimer(tabState);
      if (tabState.attached) {
        try {
          await this.debuggerApi.detach({ tabId: tabState.tabId });
        } catch {
          // Ignore detach failures during cleanup.
        }
      }
    }

    if (connection.socket.readyState !== 3) {
      connection.socket.close(1000, reason);
    }
  }

  private getOrCreateTabState(connection: ConnectionState, tabId: number): TabBindingState {
    const existing = connection.tabsById.get(tabId);
    if (existing) return existing;

    const next: TabBindingState = {
      tabId,
      attached: false,
      dialogOpen: false,
      idleTimer: null,
    };
    connection.tabsById.set(tabId, next);
    return next;
  }

  private resolveTabId(connection: ConnectionState, requestedTabId: unknown): number {
    if (typeof requestedTabId === 'number' && requestedTabId > 0) {
      return requestedTabId;
    }
    return connection.defaultTabId;
  }

  private async ensureDebuggerAttached(connection: ConnectionState, tabId: number): Promise<TabBindingState> {
    const attachableTabId = await this.resolveAttachableTabId(tabId);
    if (attachableTabId !== tabId) {
      connection.defaultTabId = attachableTabId;
    }

    const tabState = this.getOrCreateTabState(connection, attachableTabId);
    if (tabState.attached) {
      this.touchTabActivity(connection, tabState);
      return tabState;
    }

    await this.debuggerApi.attach({ tabId: attachableTabId }, '1.3');
    tabState.attached = true;
    this.touchTabActivity(connection, tabState);
    return tabState;
  }

  private async resolveAttachableTabId(preferredTabId: number): Promise<number> {
    const preferredTab = await this.safeGetTab(preferredTabId);
    if (this.isDebuggerAttachableTab(preferredTab)) {
      return preferredTabId;
    }

    const preferredWindowId = preferredTab?.windowId;
    const sameWindowTabs = preferredWindowId
      ? await this.tabsApi.query({ windowId: preferredWindowId })
      : [];
    const sameWindowFallback = this.pickAttachableTab(sameWindowTabs);
    if (sameWindowFallback?.id) {
      return sameWindowFallback.id;
    }

    const allTabs = await this.tabsApi.query({});
    const globalFallback = this.pickAttachableTab(allTabs);
    if (globalFallback?.id) {
      return globalFallback.id;
    }

    return preferredTabId;
  }

  private async safeGetTab(tabId: number): Promise<BridgeTabLike | null> {
    try {
      return await this.tabsApi.get(tabId);
    } catch {
      return null;
    }
  }

  private pickAttachableTab(tabs: BridgeTabLike[]): BridgeTabLike | null {
    const activeTab = tabs.find(tab => Boolean(tab.active) && this.isDebuggerAttachableTab(tab));
    if (activeTab) {
      return activeTab;
    }
    return tabs.find(tab => this.isDebuggerAttachableTab(tab)) ?? null;
  }

  private isDebuggerAttachableTab(tab: BridgeTabLike | null | undefined): tab is BridgeTabLike & { id: number } {
    if (!tab || typeof tab.id !== 'number') {
      return false;
    }
    return this.isDebuggerAttachableUrl(tab.url);
  }

  private isDebuggerAttachableUrl(url: string | undefined): boolean {
    if (!url) {
      return false;
    }
    return !url.startsWith('chrome://')
      && !url.startsWith('chrome-extension://')
      && !url.startsWith('devtools://')
      && !url.startsWith('edge://');
  }

  private touchTabActivity(connection: ConnectionState, tabState: TabBindingState): void {
    if (this.currentConnection !== connection || !tabState.attached) {
      this.clearTabIdleTimer(tabState);
      return;
    }

    this.clearTabIdleTimer(tabState);
    if (this.idleTimeoutMs <= 0) return;

    tabState.idleTimer = setTimeout(() => {
      void this.detachDebuggerForInactivity(connection, tabState);
    }, this.idleTimeoutMs);
  }

  private async getCurrentTargetInfo(tabId: number): Promise<any> {
    return this.debuggerApi.sendCommand({ tabId }, 'Target.getTargetInfo');
  }

  private clearTabIdleTimer(tabState: TabBindingState): void {
    if (tabState.idleTimer) {
      clearTimeout(tabState.idleTimer);
      tabState.idleTimer = null;
    }
  }

  private async detachDebuggerForInactivity(connection: ConnectionState, tabState: TabBindingState): Promise<void> {
    if (this.currentConnection !== connection || !tabState.attached) {
      return;
    }

    this.clearTabIdleTimer(tabState);
    try {
      await this.debuggerApi.detach({ tabId: tabState.tabId });
    } catch {
      // Ignore detach failures during idle cleanup.
    } finally {
      tabState.attached = false;
    }
  }

  private async closeTab(connection: ConnectionState, tabId: number): Promise<void> {
    const tabState = connection.tabsById.get(tabId);
    if (tabState) {
      this.clearTabIdleTimer(tabState);
      if (tabState.attached) {
        try {
          await this.debuggerApi.detach({ tabId });
        } catch {
          // Ignore detach failures while closing the tab.
        }
      }
      connection.tabsById.delete(tabId);
    }

    await this.tabsApi.remove(tabId);

    if (connection.defaultTabId === tabId) {
      const fallbackTabId = await this.resolveAttachableTabId(tabId);
      if (fallbackTabId && fallbackTabId !== tabId) {
        connection.defaultTabId = fallbackTabId;
        this.getOrCreateTabState(connection, fallbackTabId);
      }
    }
  }
}
