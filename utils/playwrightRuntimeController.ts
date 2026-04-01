import type { Language } from './storage';
import { isInternalPlaywrightBridgeAllowedUrl } from './internalPlaywrightBridge';

export type PlaywrightRuntimePhase = 'idle' | 'ready' | 'recovering' | 'blocked' | 'degraded';

export interface PlaywrightRuntimeTabLike {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string | null;
  title?: string | null;
}

export interface PlaywrightRuntimeSnapshot {
  phase: PlaywrightRuntimePhase;
  boundTabId: number | null;
  lockedTabId: number | null;
  targetTabId: number | null;
  targetWindowId: number | null;
  lastToolName: string | null;
  reason: string | null;
}

export interface PlaywrightRuntimePrepareResult {
  ok: boolean;
  note?: string;
  detail?: string;
  snapshot: PlaywrightRuntimeSnapshot;
}

interface PlaywrightRuntimeServerLike {
  id: string;
  name?: string;
}

interface PlaywrightRuntimeControllerInput {
  getLanguage: () => Language;
  getRuntimeServer: () => PlaywrightRuntimeServerLike | null;
  isRuntimeServerConnected: (serverId: string) => boolean;
  reconnectRuntimeServer: (server: PlaywrightRuntimeServerLike) => Promise<void>;
  getBoundTabId: () => number | null;
  setBoundTabId: (tabId: number | null) => void;
  getLockedTabId: () => number | null;
  setLockedTabId: (tabId: number | null) => void;
  queryTabs: (queryInfo: Record<string, any>) => Promise<PlaywrightRuntimeTabLike[]>;
  getTab: (tabId: number) => Promise<PlaywrightRuntimeTabLike>;
  removeTab?: (tabId: number) => Promise<void>;
  updateTab: (tabId: number, updateProperties: { active?: boolean }) => Promise<PlaywrightRuntimeTabLike | null | void>;
  createTab: (createProperties: { url?: string; active?: boolean }) => Promise<PlaywrightRuntimeTabLike>;
  bindBridge: (tabId: number, windowId?: number | null) => Promise<void>;
  focusWindow?: (windowId: number) => Promise<void>;
}

type ResolvedTarget = {
  tab: Required<Pick<PlaywrightRuntimeTabLike, 'id'>> & PlaywrightRuntimeTabLike;
  source: 'bound' | 'locked' | 'active' | 'fallback_current_window' | 'fallback_other_window';
  activeCurrentWindowTab: (Required<Pick<PlaywrightRuntimeTabLike, 'id'>> & PlaywrightRuntimeTabLike) | null;
};

type EnvironmentResolution = {
  readyTarget: ResolvedTarget | null;
  blankTarget: (Required<Pick<PlaywrightRuntimeTabLike, 'id'>> & PlaywrightRuntimeTabLike) | null;
  activeCurrentWindowTab: (Required<Pick<PlaywrightRuntimeTabLike, 'id'>> & PlaywrightRuntimeTabLike) | null;
};

export class PlaywrightRuntimeController {
  private readonly input: PlaywrightRuntimeControllerInput;
  private coreState: Omit<PlaywrightRuntimeSnapshot, 'boundTabId' | 'lockedTabId'>;
  private taskActive = false;

  constructor(input: PlaywrightRuntimeControllerInput) {
    this.input = input;
    this.coreState = {
      phase: 'idle',
      targetTabId: null,
      targetWindowId: null,
      lastToolName: null,
      reason: null,
    };
  }

  snapshot(): PlaywrightRuntimeSnapshot {
    return {
      ...this.coreState,
      boundTabId: this.input.getBoundTabId(),
      lockedTabId: this.input.getLockedTabId(),
    };
  }

  async startTask(): Promise<PlaywrightRuntimeSnapshot> {
    if (this.taskActive) {
      return this.snapshot();
    }
    // Clean up any residual state from a previous task that wasn't properly finished
    this.input.setLockedTabId(null);
    this.taskActive = true;
    const activeCurrentWindowTab = (await this.normalizeTabs(await this.safeQueryTabs({ currentWindow: true })))
      .find(candidate => Boolean(candidate.active)) ?? null;
    this.input.setLockedTabId(activeCurrentWindowTab?.id ?? null);
    this.setState({
      phase: activeCurrentWindowTab ? 'ready' : 'idle',
      reason: activeCurrentWindowTab ? 'task_started' : 'task_started_without_active_tab',
      targetTabId: activeCurrentWindowTab?.id ?? null,
      targetWindowId: activeCurrentWindowTab?.windowId ?? null,
    });
    return this.snapshot();
  }

  finishTask(reason = 'task_finished'): PlaywrightRuntimeSnapshot {
    this.taskActive = false;
    this.input.setLockedTabId(null);
    this.setState({
      phase: this.input.getBoundTabId() ? 'ready' : 'idle',
      reason,
    });
    return this.snapshot();
  }

  async prepareForTool(
    toolName: string,
    toolArguments: Record<string, any> = {},
  ): Promise<PlaywrightRuntimePrepareResult> {
    return this.prepareInternal({
      toolName,
      toolArguments,
      forceReconnect: false,
      reason: 'prepare',
    });
  }

  async recoverForSessionError(
    toolName: string,
    toolArguments: Record<string, any> = {},
    errorMessage: string,
  ): Promise<PlaywrightRuntimePrepareResult> {
    this.setState({
      phase: 'recovering',
      lastToolName: toolName,
      reason: this.classifyRecoveryReason(errorMessage),
    });
    return this.prepareInternal({
      toolName,
      toolArguments,
      forceReconnect: true,
      reason: this.classifyRecoveryReason(errorMessage),
    });
  }

  async listTabs(): Promise<Array<{
    id: number;
    windowId?: number;
    title: string;
    url: string;
    current: boolean;
    active: boolean;
  }>> {
    const tabs = await this.normalizeTabs(await this.safeQueryTabs({}));
    const currentTabId = this.input.getBoundTabId();
    return tabs
      .filter(tab => tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('devtools://'))
      .map(tab => ({
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title || tab.url || 'Untitled',
        url: tab.url || 'about:blank',
        current: tab.id === currentTabId,
        active: Boolean(tab.active),
      }));
  }

  async createBlankTab(): Promise<PlaywrightRuntimePrepareResult> {
    const createdTab = await this.input.createTab({
      url: 'about:blank',
      active: true,
    });
    if (!createdTab?.id) {
      throw new Error('无法创建新的标签页');
    }
    return this.bindExplicitTab(createdTab.id, createdTab.windowId ?? null, {
      forceReconnect: true,
      reason: 'explicit_blank_tab',
    });
  }

  async bindExplicitTab(
    tabId: number,
    windowId?: number | null,
    input: {
      forceReconnect?: boolean;
      reason?: string;
      note?: string;
    } = {},
  ): Promise<PlaywrightRuntimePrepareResult> {
    const tab = this.normalizeTab(await this.safeGetTab(tabId));
    if (!tab) {
      throw new Error('目标标签页不存在');
    }
    const activeCurrentWindowTab = (await this.normalizeTabs(await this.safeQueryTabs({ currentWindow: true })))
      .find(candidate => Boolean(candidate.active)) ?? null;

    return this.activateTarget(
      this.input.getRuntimeServer() ?? { id: 'builtin-playwright-gateway' },
      {
        tab,
        source: 'bound',
        activeCurrentWindowTab,
      },
      {
        toolName: 'browser_tabs',
        forceReconnect: input.forceReconnect ?? true,
        reason: input.reason ?? 'explicit_bind',
        note: input.note,
      },
    );
  }

  async clearBinding(): Promise<void> {
    this.input.setBoundTabId(null);
    this.setState({
      phase: 'idle',
      targetTabId: null,
      targetWindowId: null,
      lastToolName: this.coreState.lastToolName,
      reason: 'binding_cleared',
    });
  }

  async closeTab(tabId: number): Promise<PlaywrightRuntimePrepareResult> {
    if (!this.input.removeTab) {
      throw new Error('当前 runtime 不支持关闭标签页');
    }

    const closedBoundTab = this.input.getBoundTabId() === tabId;
    const closedLockedTab = this.input.getLockedTabId() === tabId;

    await this.input.removeTab(tabId);

    if (closedLockedTab) {
      this.input.setLockedTabId(null);
    }
    if (closedBoundTab) {
      this.input.setBoundTabId(null);
    }

    const resolution = await this.resolveEnvironment();
    if (resolution.readyTarget) {
      return this.activateTarget(
        this.input.getRuntimeServer() ?? { id: 'builtin-playwright-gateway' },
        resolution.readyTarget,
        {
          toolName: 'browser_tabs',
          forceReconnect: true,
          reason: 'tabs_close_fallback',
        },
      );
    }

    this.setState({
      phase: 'idle',
      targetTabId: null,
      targetWindowId: null,
      lastToolName: 'browser_tabs',
      reason: 'tabs_close_without_fallback',
    });
    return {
      ok: true,
      snapshot: this.snapshot(),
    };
  }

  private async prepareInternal(input: {
    toolName: string;
    toolArguments: Record<string, any>;
    forceReconnect: boolean;
    reason: string;
  }): Promise<PlaywrightRuntimePrepareResult> {
    const runtimeServer = this.input.getRuntimeServer();
    if (!runtimeServer) {
      this.setState({
        phase: 'idle',
        lastToolName: input.toolName,
        reason: 'no_runtime_server',
        targetTabId: null,
        targetWindowId: null,
      });
      return {
        ok: true,
        snapshot: this.snapshot(),
      };
    }

    const intent = this.getToolIntent(input.toolName);
    const resolution = await this.resolveEnvironment();

    if (resolution.readyTarget) {
      return this.activateTarget(runtimeServer, resolution.readyTarget, {
        toolName: input.toolName,
        forceReconnect: input.forceReconnect,
        reason: input.reason,
      });
    }

    if (intent === 'navigate') {
      const url = typeof input.toolArguments.url === 'string' ? input.toolArguments.url.trim() : '';
      if (!url) {
        this.setState({
          phase: 'blocked',
          lastToolName: input.toolName,
          reason: 'missing_navigation_url',
          targetTabId: null,
          targetWindowId: null,
        });
        return {
          ok: false,
          detail: this.buildMissingNavigationUrlMessage(),
          snapshot: this.snapshot(),
        };
      }

      const createdTab = await this.input.createTab({
        url,
        active: true,
      });
      if (!createdTab?.id) {
        throw new Error('无法创建导航恢复标签页');
      }

      await this.input.bindBridge(createdTab.id, createdTab.windowId);
      this.input.setBoundTabId(createdTab.id);
      await this.input.reconnectRuntimeServer(runtimeServer);
      this.setState({
        phase: 'ready',
        lastToolName: input.toolName,
        reason: 'navigation_bootstrap',
        targetTabId: createdTab.id,
        targetWindowId: createdTab.windowId ?? null,
      });
      return {
        ok: true,
        note: this.buildNavigationBootstrapNote(),
        snapshot: this.snapshot(),
      };
    }

    this.setState({
      phase: 'blocked',
      lastToolName: input.toolName,
      reason: 'no_recoverable_target',
      targetTabId: null,
      targetWindowId: null,
    });
    return {
      ok: false,
      detail: this.buildBlockedMessage(resolution.activeCurrentWindowTab),
      snapshot: this.snapshot(),
    };
  }

  private async activateTarget(
    runtimeServer: PlaywrightRuntimeServerLike,
    target: ResolvedTarget,
    input: {
      toolName: string;
      forceReconnect: boolean;
      reason: string;
      note?: string;
    },
  ): Promise<PlaywrightRuntimePrepareResult> {
    this.setState({
      phase: 'recovering',
      lastToolName: input.toolName,
      reason: input.reason,
      targetTabId: target.tab.id,
      targetWindowId: target.tab.windowId ?? null,
    });

    const currentWindowId = target.activeCurrentWindowTab?.windowId ?? null;
    if (target.tab.windowId && currentWindowId && target.tab.windowId !== currentWindowId && this.input.focusWindow) {
      await this.input.focusWindow(target.tab.windowId).catch(() => {});
    }

    if (!target.tab.active) {
      await this.input.updateTab(target.tab.id, { active: true });
    }

    const boundTabId = this.input.getBoundTabId();
    const needsBind = boundTabId !== target.tab.id;
    if (needsBind) {
      await this.input.bindBridge(target.tab.id, target.tab.windowId);
      this.input.setBoundTabId(target.tab.id);
    }

    const connected = this.input.isRuntimeServerConnected(runtimeServer.id);
    if (input.forceReconnect || needsBind || !connected) {
      await this.input.reconnectRuntimeServer(runtimeServer);
    }

    this.setState({
      phase: this.isMeaningfulTarget(target.tab.url) ? 'ready' : 'degraded',
      lastToolName: input.toolName,
      reason: input.reason,
      targetTabId: target.tab.id,
      targetWindowId: target.tab.windowId ?? null,
    });

    const note = input.note ?? this.buildTargetNote(target);
    return {
      ok: true,
      ...(note ? { note } : {}),
      snapshot: this.snapshot(),
    };
  }

  private async resolveEnvironment(): Promise<EnvironmentResolution> {
    const currentWindowTabs = await this.normalizeTabs(await this.safeQueryTabs({ currentWindow: true }));
    const allTabs = await this.normalizeTabs(await this.safeQueryTabs({}));
    const activeCurrentWindowTab = currentWindowTabs.find(tab => Boolean(tab.active)) ?? null;

    const preferredReadyCandidates: Array<ResolvedTarget | null> = [
      await this.resolvePreferredTarget(this.input.getLockedTabId(), 'locked', activeCurrentWindowTab),
      await this.resolvePreferredTarget(this.input.getBoundTabId(), 'bound', activeCurrentWindowTab),
    ];
    for (const candidate of preferredReadyCandidates) {
      if (candidate) {
        return {
          readyTarget: candidate,
          blankTarget: null,
          activeCurrentWindowTab,
        };
      }
    }

    if (activeCurrentWindowTab && this.isMeaningfulTarget(activeCurrentWindowTab.url)) {
      return {
        readyTarget: {
          tab: activeCurrentWindowTab,
          source: 'active',
          activeCurrentWindowTab,
        },
        blankTarget: null,
        activeCurrentWindowTab,
      };
    }

    const currentWindowFallback = currentWindowTabs.find(tab => this.isMeaningfulTarget(tab.url)) ?? null;
    if (currentWindowFallback) {
      return {
        readyTarget: {
          tab: currentWindowFallback,
          source: 'fallback_current_window',
          activeCurrentWindowTab,
        },
        blankTarget: null,
        activeCurrentWindowTab,
      };
    }

    const otherWindowFallback = allTabs.find(tab => {
      if (!this.isMeaningfulTarget(tab.url)) return false;
      return tab.windowId !== activeCurrentWindowTab?.windowId;
    }) ?? null;
    if (otherWindowFallback) {
      return {
        readyTarget: {
          tab: otherWindowFallback,
          source: 'fallback_other_window',
          activeCurrentWindowTab,
        },
        blankTarget: null,
        activeCurrentWindowTab,
      };
    }

    const blankTarget = preferredReadyCandidates
      .map(candidate => candidate?.tab ?? null)
      .find(tab => tab?.url === 'about:blank')
      ?? currentWindowTabs.find(tab => tab.url === 'about:blank')
      ?? null;

    return {
      readyTarget: null,
      blankTarget,
      activeCurrentWindowTab,
    };
  }

  private async resolvePreferredTarget(
    tabId: number | null,
    source: 'bound' | 'locked',
    activeCurrentWindowTab: (Required<Pick<PlaywrightRuntimeTabLike, 'id'>> & PlaywrightRuntimeTabLike) | null,
  ): Promise<ResolvedTarget | null> {
    if (!tabId) return null;
    try {
      const tab = await this.safeGetTab(tabId);
      if (!tab) return null;
      const normalized = this.normalizeTab(tab);
      if (!normalized || !this.isMeaningfulTarget(normalized.url)) {
        return null;
      }
      return {
        tab: normalized,
        source,
        activeCurrentWindowTab,
      };
    } catch {
      return null;
    }
  }

  private async normalizeTabs(tabs: PlaywrightRuntimeTabLike[]): Promise<Array<Required<Pick<PlaywrightRuntimeTabLike, 'id'>> & PlaywrightRuntimeTabLike>> {
    return tabs
      .map(tab => this.normalizeTab(tab))
      .filter((tab): tab is Required<Pick<PlaywrightRuntimeTabLike, 'id'>> & PlaywrightRuntimeTabLike => Boolean(tab));
  }

  private normalizeTab(tab: PlaywrightRuntimeTabLike | null | undefined) {
    if (!tab || typeof tab.id !== 'number' || tab.id <= 0) {
      return null;
    }
    return tab as Required<Pick<PlaywrightRuntimeTabLike, 'id'>> & PlaywrightRuntimeTabLike;
  }

  private setState(patch: Partial<Omit<PlaywrightRuntimeSnapshot, 'boundTabId' | 'lockedTabId'>>): void {
    this.coreState = { ...this.coreState, ...patch };
  }

  private async safeQueryTabs(queryInfo: Record<string, any>): Promise<PlaywrightRuntimeTabLike[]> {
    return Promise.race([
      this.input.queryTabs(queryInfo),
      new Promise<PlaywrightRuntimeTabLike[]>((resolve) => setTimeout(() => resolve([]), 5000)),
    ]);
  }

  private async safeGetTab(tabId: number): Promise<PlaywrightRuntimeTabLike | null> {
    try {
      return await Promise.race([
        this.input.getTab(tabId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
    } catch {
      return null;
    }
  }

  private getToolIntent(toolName: string): 'navigate' | 'targeted' {
    return toolName === 'browser_navigate' ? 'navigate' : 'targeted';
  }

  private isMeaningfulTarget(url: string | null | undefined): boolean {
    return isInternalPlaywrightBridgeAllowedUrl(url);
  }

  private classifyRecoveryReason(errorMessage: string): string {
    if (/browserContext\.newPage|No open pages available/i.test(errorMessage)) {
      return 'missing_page';
    }
    if (/Target page, context or browser has been closed|Session closed|Target closed/i.test(errorMessage)) {
      return 'session_closed';
    }
    if (/Failed to fetch|ECONNREFUSED|ECONNRESET/i.test(errorMessage)) {
      return 'transport_error';
    }
    return 'runtime_error';
  }

  private buildBlockedMessage(activeTab: PlaywrightRuntimeTabLike | null): string {
    const currentPageBlocked = activeTab?.url && !this.isMeaningfulTarget(activeTab.url);
    if (this.input.getLanguage() === 'zh-CN') {
      return currentPageBlocked
        ? '当前页面不是可调试网页，且所有窗口里都没有可恢复的网页标签页。请先打开一个普通网页后再继续。'
        : '所有窗口里都没有可恢复的网页标签页。请先打开一个普通网页后再继续。';
    }
    return currentPageBlocked
      ? 'The current page is not a debuggable webpage, and there are no recoverable web tabs in any window. Open a normal webpage before continuing.'
      : 'There are no recoverable web tabs in any window. Open a normal webpage before continuing.';
  }

  private buildMissingNavigationUrlMessage(): string {
    return this.input.getLanguage() === 'zh-CN'
      ? 'browser_navigate 缺少有效的 url 参数，runtime 无法自动继续导航。'
      : 'browser_navigate is missing a valid URL argument, so the runtime cannot continue navigation automatically.';
  }

  private buildTargetNote(target: ResolvedTarget): string | undefined {
    if (target.source === 'fallback_other_window') {
      return this.input.getLanguage() === 'zh-CN'
        ? `已自动切换到其它窗口中的“${this.getTabLabel(target.tab)}”继续执行。`
        : `Switched to "${this.getTabLabel(target.tab)}" in another window to continue.`;
    }
    if (target.source === 'fallback_current_window' || target.source === 'active') {
      return undefined;
    }
    return this.input.getLanguage() === 'zh-CN'
      ? `已切换到“${this.getTabLabel(target.tab)}”继续执行。`
      : `Switched to "${this.getTabLabel(target.tab)}" to continue.`;
  }

  private buildNavigationBootstrapNote(): string {
    return this.input.getLanguage() === 'zh-CN'
      ? '当前没有可恢复网页，已直接打开目标网址继续执行。'
      : 'No recoverable webpage was available, so the target URL was opened directly.';
  }

  private getTabLabel(tab: PlaywrightRuntimeTabLike): string {
    return tab.title?.trim() || tab.url?.trim() || `Tab ${tab.id ?? 'unknown'}`;
  }
}
