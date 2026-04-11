/**
 * 存储层 - WXT Storage 用于需要跨页面同步的配置数据
 * AI Providers 和 Trusted Scripts 使用 WXT storage（自动同步）
 * 其他大数据继续使用 IndexedDB
 */

import { storage } from '@wxt-dev/storage';

// ==================== 类型定义 ====================

export type ProviderType = 'openai' | 'gemini' | 'anthropic';

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModel: string;
  visionModelSupport: Record<string, boolean>;
  providerType?: ProviderType;
}

export interface TrustedScript {
  skillId: string;
  scriptName: string;
  trustedAt: number;
}

// ==================== Storage Items ====================

const providersStorage = storage.defineItem<AIProvider[]>('local:providers', {
  fallback: [],
});

const activeProviderIdStorage = storage.defineItem<string | null>('local:activeProviderId', {
  fallback: null,
});

const trustedScriptsStorage = storage.defineItem<TrustedScript[]>('local:trustedScripts', {
  fallback: [],
});

// ==================== Theme Settings ====================

export type ThemeMode = 'light' | 'dark' | 'system';

const themeModeStorage = storage.defineItem<ThemeMode>('local:themeMode', {
  fallback: 'system',
});

export async function getThemeMode(): Promise<ThemeMode> {
  return await themeModeStorage.getValue();
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await themeModeStorage.setValue(mode);
}

export function watchThemeMode(callback: (mode: ThemeMode) => void): () => void {
  return themeModeStorage.watch((newValue) => {
    callback(newValue);
  });
}

// 根据主题模式获取实际应用的主题
export function getResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

// 应用主题到 document
export function applyTheme(mode: ThemeMode): void {
  const theme = getResolvedTheme(mode);
  document.documentElement.setAttribute('data-theme', theme);
}

// ==================== Language Settings ====================

export type Language = 'en' | 'zh-CN';

const languageStorage = storage.defineItem<Language>('local:language', {
  fallback: 'en',
});

export async function getLanguage(): Promise<Language> {
  return await languageStorage.getValue();
}

export async function setLanguage(lang: Language): Promise<void> {
  await languageStorage.setValue(lang);
}

export function watchLanguage(callback: (lang: Language) => void): () => void {
  return languageStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Floating Ball Settings ====================

const floatingBallEnabledStorage = storage.defineItem<boolean>('local:floatingBallEnabled', {
  fallback: true,
});

export async function getFloatingBallEnabled(): Promise<boolean> {
  return await floatingBallEnabledStorage.getValue();
}

export async function setFloatingBallEnabled(enabled: boolean): Promise<void> {
  await floatingBallEnabledStorage.setValue(enabled);
}

export function watchFloatingBallEnabled(callback: (enabled: boolean) => void): () => void {
  return floatingBallEnabledStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Selection Quote Settings ====================

const selectionQuoteEnabledStorage = storage.defineItem<boolean>('local:selectionQuoteEnabled', {
  fallback: true,
});

export async function getSelectionQuoteEnabled(): Promise<boolean> {
  return await selectionQuoteEnabledStorage.getValue();
}

export async function setSelectionQuoteEnabled(enabled: boolean): Promise<void> {
  await selectionQuoteEnabledStorage.setValue(enabled);
}

export function watchSelectionQuoteEnabled(callback: (enabled: boolean) => void): () => void {
  return selectionQuoteEnabledStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Raw Extract Sites Settings ====================

const rawExtractSitesStorage = storage.defineItem<string[]>('local:rawExtractSites', {
  fallback: [],
});

export async function getRawExtractSites(): Promise<string[]> {
  return await rawExtractSitesStorage.getValue();
}

export async function setRawExtractSites(sites: string[]): Promise<void> {
  await rawExtractSitesStorage.setValue(sites);
}

export async function addRawExtractSite(site: string): Promise<void> {
  const sites = await rawExtractSitesStorage.getValue();
  const normalized = site.toLowerCase().trim();
  if (normalized && !sites.includes(normalized)) {
    sites.push(normalized);
    await rawExtractSitesStorage.setValue(sites);
  }
}

export async function removeRawExtractSite(site: string): Promise<void> {
  const sites = await rawExtractSitesStorage.getValue();
  await rawExtractSitesStorage.setValue(sites.filter(s => s !== site));
}

export function watchRawExtractSites(callback: (sites: string[]) => void): () => void {
  return rawExtractSitesStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Page Content Limit Settings ====================

const maxPageContentLengthStorage = storage.defineItem<number>('local:maxPageContentLength', {
  fallback: 30000,
});

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeIntInRange(value: number, fallback: number, min: number, max: number): number {
  const normalized = normalizePositiveInt(value, fallback);
  return Math.min(max, Math.max(min, normalized));
}

export async function getMaxPageContentLength(): Promise<number> {
  const value = await maxPageContentLengthStorage.getValue();
  return normalizePositiveInt(value, 30000);
}

export async function setMaxPageContentLength(value: number): Promise<void> {
  await maxPageContentLengthStorage.setValue(normalizePositiveInt(value, 30000));
}

export function watchMaxPageContentLength(callback: (value: number) => void): () => void {
  return maxPageContentLengthStorage.watch((newValue) => {
    callback(normalizePositiveInt(newValue, 30000));
  });
}

// ==================== Tool Call Limit Settings ====================

const maxToolCallsStorage = storage.defineItem<number>('local:maxToolCalls', {
  fallback: 100,
});

// ==================== Browser Automation Settings ====================

const browserAutomationEnabledStorage = storage.defineItem<boolean>('local:browserAutomationEnabled', {
  fallback: true,
});

const browserAutomationHighlightEnabledStorage = storage.defineItem<boolean>('local:browserAutomationHighlightEnabled', {
  fallback: false,
});

const browserAutomationMaxIterationsStorage = storage.defineItem<number>('local:browserAutomationMaxIterations', {
  fallback: 20,
});

const browserAutomationPageReadyTimeoutMsStorage = storage.defineItem<number>('local:browserAutomationPageReadyTimeoutMs', {
  fallback: 7000,
});

const modelRequestMaxRetriesStorage = storage.defineItem<number>('local:modelRequestMaxRetries', {
  fallback: 5,
});

// ==================== Preset Actions Settings ====================

export interface PresetAction {
  id: string;
  name: string;
  content: string;
  createdAt: number;
}

const presetActionsStorage = storage.defineItem<PresetAction[]>('local:presetActions', {
  fallback: [],
});

export async function getPresetActions(): Promise<PresetAction[]> {
  return await presetActionsStorage.getValue();
}

export async function setPresetActions(presets: PresetAction[]): Promise<void> {
  await presetActionsStorage.setValue(presets);
}

export async function addPresetAction(name: string, content: string): Promise<PresetAction> {
  const presets = await presetActionsStorage.getValue();
  const newPreset: PresetAction = {
    id: crypto.randomUUID(),
    name: name.trim(),
    content: content.trim(),
    createdAt: Date.now(),
  };
  presets.push(newPreset);
  await presetActionsStorage.setValue(presets);
  return newPreset;
}

export async function updatePresetAction(id: string, name: string, content: string): Promise<void> {
  const presets = await presetActionsStorage.getValue();
  const index = presets.findIndex(p => p.id === id);
  if (index >= 0) {
    presets[index].name = name.trim();
    presets[index].content = content.trim();
    await presetActionsStorage.setValue(presets);
  }
}

export async function deletePresetAction(id: string): Promise<void> {
  const presets = await presetActionsStorage.getValue();
  await presetActionsStorage.setValue(presets.filter(p => p.id !== id));
}

export function watchPresetActions(callback: (presets: PresetAction[]) => void): () => void {
  return presetActionsStorage.watch((newValue) => {
    callback(newValue);
  });
}

export async function getMaxToolCalls(): Promise<number> {
  const value = await maxToolCallsStorage.getValue();
  return normalizePositiveInt(value, 100);
}

export async function setMaxToolCalls(value: number): Promise<void> {
  await maxToolCallsStorage.setValue(normalizePositiveInt(value, 100));
}

export function watchMaxToolCalls(callback: (value: number) => void): () => void {
  return maxToolCallsStorage.watch((newValue) => {
    callback(normalizePositiveInt(newValue, 100));
  });
}

export async function getBrowserAutomationEnabled(): Promise<boolean> {
  return await browserAutomationEnabledStorage.getValue();
}

export async function setBrowserAutomationEnabled(enabled: boolean): Promise<void> {
  await browserAutomationEnabledStorage.setValue(Boolean(enabled));
}

export function watchBrowserAutomationEnabled(callback: (enabled: boolean) => void): () => void {
  return browserAutomationEnabledStorage.watch((newValue) => {
    callback(Boolean(newValue));
  });
}

export async function getBrowserAutomationHighlightEnabled(): Promise<boolean> {
  return await browserAutomationHighlightEnabledStorage.getValue();
}

export async function setBrowserAutomationHighlightEnabled(enabled: boolean): Promise<void> {
  await browserAutomationHighlightEnabledStorage.setValue(Boolean(enabled));
}

export function watchBrowserAutomationHighlightEnabled(callback: (enabled: boolean) => void): () => void {
  return browserAutomationHighlightEnabledStorage.watch((newValue) => {
    callback(Boolean(newValue));
  });
}

export async function getBrowserAutomationMaxIterations(): Promise<number> {
  const value = await browserAutomationMaxIterationsStorage.getValue();
  return normalizeIntInRange(value, 20, 1, 100);
}

export async function setBrowserAutomationMaxIterations(value: number): Promise<void> {
  await browserAutomationMaxIterationsStorage.setValue(normalizeIntInRange(value, 20, 1, 100));
}

export function watchBrowserAutomationMaxIterations(callback: (value: number) => void): () => void {
  return browserAutomationMaxIterationsStorage.watch((newValue) => {
    callback(normalizeIntInRange(newValue, 20, 1, 100));
  });
}

export async function getBrowserAutomationPageReadyTimeoutMs(): Promise<number> {
  const value = await browserAutomationPageReadyTimeoutMsStorage.getValue();
  return normalizeIntInRange(value, 7000, 1000, 60000);
}

export async function setBrowserAutomationPageReadyTimeoutMs(value: number): Promise<void> {
  await browserAutomationPageReadyTimeoutMsStorage.setValue(normalizeIntInRange(value, 7000, 1000, 60000));
}

export function watchBrowserAutomationPageReadyTimeoutMs(callback: (value: number) => void): () => void {
  return browserAutomationPageReadyTimeoutMsStorage.watch((newValue) => {
    callback(normalizeIntInRange(newValue, 7000, 1000, 60000));
  });
}

export async function getModelRequestMaxRetries(): Promise<number> {
  const value = await modelRequestMaxRetriesStorage.getValue();
  return normalizeIntInRange(value, 5, 1, 10);
}

export async function setModelRequestMaxRetries(value: number): Promise<void> {
  await modelRequestMaxRetriesStorage.setValue(normalizeIntInRange(value, 5, 1, 10));
}

export function watchModelRequestMaxRetries(callback: (value: number) => void): () => void {
  return modelRequestMaxRetriesStorage.watch((newValue) => {
    callback(normalizeIntInRange(newValue, 5, 1, 10));
  });
}

// 检查 URL 是否匹配原始提取网站列表
export function isRawExtractSite(url: string, sites: string[]): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return sites.some(site => hostname.includes(site));
  } catch {
    return false;
  }
}

// 检测浏览器语言并返回匹配的语言设置
export function detectBrowserLanguage(): Language {
  const browserLang = navigator.language || (navigator as any).userLanguage || 'en';
  // 检查是否为简体中文
  if (browserLang.toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en';
}

// 初始化语言设置（仅在首次安装时调用）
export async function initializeLanguage(): Promise<void> {
  const detectedLang = detectBrowserLanguage();
  await setLanguage(detectedLang);
}

// ==================== Watch Helpers ====================

export function watchProviders(callback: (providers: AIProvider[]) => void): () => void {
  return providersStorage.watch((newValue) => {
    callback(newValue.map(normalizeProvider));
  });
}

export function watchActiveProviderId(callback: (id: string | null) => void): () => void {
  return activeProviderIdStorage.watch((newValue) => {
    callback(newValue);
  });
}

// ==================== Providers ====================

export async function getAllProviders(): Promise<AIProvider[]> {
  const providers = await providersStorage.getValue();
  return providers.map(normalizeProvider);
}

export async function getProvider(id: string): Promise<AIProvider | undefined> {
  const providers = await providersStorage.getValue();
  const provider = providers.find((p: AIProvider) => p.id === id);
  return provider ? normalizeProvider(provider) : undefined;
}

export async function saveProvider(provider: AIProvider): Promise<void> {
  const providers = (await providersStorage.getValue()).map(normalizeProvider);
  const normalizedProvider = normalizeProvider(provider);
  const index = providers.findIndex((p: AIProvider) => p.id === provider.id);
  if (index >= 0) {
    providers[index] = normalizedProvider;
  } else {
    providers.push(normalizedProvider);
  }
  await providersStorage.setValue(providers);
}

export async function deleteProvider(id: string): Promise<void> {
  const providers = await providersStorage.getValue();
  await providersStorage.setValue(providers.filter((p: AIProvider) => p.id !== id));
}

export async function getActiveProvider(): Promise<AIProvider | null> {
  const activeId = await activeProviderIdStorage.getValue();
  if (!activeId) return null;
  const provider = await getProvider(activeId);
  return provider ? normalizeProvider(provider) : null;
}

export async function setActiveProviderId(id: string | null): Promise<void> {
  await activeProviderIdStorage.setValue(id);
}

type LegacyProvider = Partial<AIProvider> & {
  supportsVision?: boolean;
  visionModelSupport?: Record<string, boolean> | undefined;
};

function normalizeModelList(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return Array.from(
    new Set(
      models
        .filter((model): model is string => typeof model === 'string')
        .map(model => model.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeVisionModelSupport(
  models: string[],
  provider: LegacyProvider,
): Record<string, boolean> {
  const rawSupport = provider.visionModelSupport;
  const supportMap: Record<string, boolean> =
    rawSupport && typeof rawSupport === 'object' && !Array.isArray(rawSupport)
      ? rawSupport
      : {};
  const legacySupportsVision = Boolean(provider.supportsVision);
  const normalized: Record<string, boolean> = {};
  for (const model of models) {
    const value = supportMap[model];
    normalized[model] = typeof value === 'boolean' ? value : legacySupportsVision;
  }
  return normalized;
}

function normalizeProvider(provider: AIProvider): AIProvider {
  const legacyProvider = provider as LegacyProvider;
  const models = normalizeModelList(legacyProvider.models);
  const selectedModel =
    typeof legacyProvider.selectedModel === 'string' && models.includes(legacyProvider.selectedModel)
      ? legacyProvider.selectedModel
      : models[0] || '';
  const visionModelSupport = normalizeVisionModelSupport(models, legacyProvider);

  const result: AIProvider = {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    models,
    selectedModel,
    visionModelSupport,
  };
  if ((provider as any).providerType) {
    result.providerType = (provider as any).providerType;
  }
  return result;
}

export function isVisionSupportedForModel(
  provider: AIProvider | null | undefined,
  model?: string | null,
): boolean {
  if (!provider) return false;
  const targetModel = model ?? provider.selectedModel;
  if (!targetModel) return false;
  return Boolean(provider.visionModelSupport?.[targetModel]);
}

// ==================== Trusted Scripts ====================

export async function isScriptTrusted(skillId: string, scriptName: string): Promise<boolean> {
  const scripts = await trustedScriptsStorage.getValue();
  return scripts.some((s: TrustedScript) => s.skillId === skillId && s.scriptName === scriptName);
}

export async function trustScript(skillId: string, scriptName: string): Promise<void> {
  const scripts = await trustedScriptsStorage.getValue();
  if (!scripts.some((s: TrustedScript) => s.skillId === skillId && s.scriptName === scriptName)) {
    scripts.push({ skillId, scriptName, trustedAt: Date.now() });
    await trustedScriptsStorage.setValue(scripts);
  }
}

export async function untrustScript(skillId: string, scriptName: string): Promise<void> {
  const scripts = await trustedScriptsStorage.getValue();
  await trustedScriptsStorage.setValue(
    scripts.filter((s: TrustedScript) => !(s.skillId === skillId && s.scriptName === scriptName))
  );
}

export async function getTrustedScripts(): Promise<TrustedScript[]> {
  return await trustedScriptsStorage.getValue();
}

// 删除某个 skill 的所有信任记录
export async function removeTrustedScriptsBySkillId(skillId: string): Promise<void> {
  const scripts = await trustedScriptsStorage.getValue();
  await trustedScriptsStorage.setValue(scripts.filter((s: TrustedScript) => s.skillId !== skillId));
}

// ==================== 重新导出 IndexedDB 的其他功能 ====================

export type {
  ChatMessage,
  ApiMessageRecord,
  ChatSession,
} from './db';

// Session functions
export {
  getAllSessions,
  getSession,
  getCurrentSession,
  setCurrentSessionId,
  createSession,
  updateSession,
  deleteSession,
  generateSessionTitle,
} from './db';

// Settings
export {
  getSharePageContent,
  setSharePageContent,
} from './db';
