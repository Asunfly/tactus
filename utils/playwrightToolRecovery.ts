import type { Language } from './storage';

const PLAYWRIGHT_STALE_REF_PATTERN = /Ref\s+([^\s]+)\s+not found in the current page snapshot\. Try capturing new snapshot\./i;
const PLAYWRIGHT_SESSION_ERROR_PATTERNS = [
  /Target page, context or browser has been closed/i,
  /browserType\.connectOverCDP/i,
  /browserContext\.newPage/i,
  /Extension disconnected/i,
  /Cannot find context with specified id/i,
  /Session closed/i,
  /Target closed/i,
  /Failed to fetch/i,
];
const PLAYWRIGHT_TIMEOUT_ERROR_PATTERNS = [
  /TimeoutError:/i,
  /Timeout \d+ms exceeded/i,
  /subtree intercepts pointer events/i,
];
const PLAYWRIGHT_SNAPSHOT_HINTS = new Set([
  'browser_click',
  'browser_drag',
  'browser_fill_form',
  'browser_hover',
  'browser_navigate',
  'browser_press_key',
  'browser_select_option',
  'browser_type',
]);
const PLAYWRIGHT_REF_KEYS = new Set([
  'ref',
  'startRef',
  'endRef',
]);

export type PlaywrightRecoveryStage = 'preflight' | 'fallback';
export type PlaywrightInteractionRecoveryStage = 'timeout';

export function collectPlaywrightToolRefs(
  _toolName: string,
  args: Record<string, unknown> | undefined,
): string[] {
  const refs = new Set<string>();

  const visit = (value: unknown, parentKey?: string) => {
    if (typeof value === 'string' && parentKey && PLAYWRIGHT_REF_KEYS.has(parentKey)) {
      const trimmed = value.trim();
      if (trimmed) {
        refs.add(trimmed);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (value && typeof value === 'object') {
      for (const [key, nestedValue] of Object.entries(value)) {
        visit(nestedValue, key);
      }
    }
  };

  visit(args);
  return Array.from(refs);
}

export function findMissingPlaywrightSnapshotRefs(snapshot: string, refs: string[]): string[] {
  return refs.filter((ref) => {
    const pattern = new RegExp(`\\bref=${escapeRegExp(ref)}\\b`);
    return !pattern.test(snapshot);
  });
}

export function isPlaywrightStaleRefError(message: string): boolean {
  return PLAYWRIGHT_STALE_REF_PATTERN.test(message);
}

export function isPlaywrightRecoverableSessionError(message: string): boolean {
  return PLAYWRIGHT_SESSION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function isPlaywrightMissingPageError(message: string): boolean {
  return /browserContext\.newPage/i.test(message) || /No open pages available\./i.test(message);
}

export function isPlaywrightInteractionTimeoutError(message: string): boolean {
  return PLAYWRIGHT_TIMEOUT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function shouldPreflightPlaywrightSnapshot(
  toolName: string,
  args: Record<string, unknown> | undefined,
): boolean {
  if (toolName === 'browser_snapshot') {
    return false;
  }

  return collectPlaywrightToolRefs(toolName, args).length > 0;
}

export function shouldSuggestLatestSnapshotHint(toolName: string): boolean {
  return PLAYWRIGHT_SNAPSHOT_HINTS.has(toolName);
}

export function appendPlaywrightSnapshotHint(
  toolName: string,
  content: string,
  language: Language,
): string {
  if (!shouldSuggestLatestSnapshotHint(toolName)) {
    return content;
  }

  const hint = language === 'zh-CN'
    ? '请仅使用上面最新页面快照中的 ref 继续后续操作；如果页面已经变化，不要复用之前的 ref。'
    : 'Use only refs from the latest page snapshot above for the next action. Do not reuse earlier refs after the page changes.';

  if (content.includes(hint)) {
    return content;
  }

  return `${content}\n\n${hint}`;
}

export function buildPlaywrightStaleRefRecoveryMessage(input: {
  toolName: string;
  staleRefs: string[];
  snapshot: string;
  language: Language;
  stage: PlaywrightRecoveryStage;
}): string {
  const refs = input.staleRefs.join(', ');
  const actionText = input.language === 'zh-CN'
    ? `${input.toolName} 未执行，因为引用的 ref 已经过期。`
    : `${input.toolName} was not executed because the referenced ref is stale.`;
  const stageText = input.language === 'zh-CN'
    ? (
        input.stage === 'preflight'
          ? '在执行前检查到页面已经变化。'
          : '执行时检测到页面已经变化。'
      )
    : (
        input.stage === 'preflight'
          ? 'The page changed before the action ran.'
          : 'The page changed while the action was running.'
      );
  const guidance = input.language === 'zh-CN'
    ? '下面是最新页面快照。请只使用这份快照里的新 ref 继续下一步，不要复用旧 ref。'
    : 'The latest page snapshot is below. Use only the new refs from this snapshot for the next step and do not reuse the old refs.';
  const label = input.language === 'zh-CN' ? '已失效 ref' : 'Stale refs';
  const snapshotLabel = input.language === 'zh-CN' ? '最新页面快照' : 'Latest page snapshot';

  return [
    actionText,
    stageText,
    `${label}: ${refs}`,
    guidance,
    `${snapshotLabel}:`,
    input.snapshot,
  ].join('\n\n');
}

export function buildPlaywrightInteractionRecoveryMessage(input: {
  toolName: string;
  errorMessage: string;
  snapshot: string;
  language: Language;
  stage: PlaywrightInteractionRecoveryStage;
}): string {
  const actionText = input.language === 'zh-CN'
    ? `${input.toolName} 未执行成功，当前页面状态可能已经和预期不一致。`
    : `${input.toolName} did not complete successfully because the page state no longer matched the expected target.`;
  const stageText = input.language === 'zh-CN'
    ? '工具执行时发生了交互超时或目标不可操作。'
    : 'The tool hit an interaction timeout or the target was no longer actionable.';
  const guidance = input.language === 'zh-CN'
    ? '下面是最新页面快照。请基于这份快照重新判断下一步，不要继续沿用刚才那次失败调用里的定位假设。'
    : 'The latest page snapshot is below. Re-evaluate the next step from this snapshot instead of reusing the assumptions from the failed call.';
  const errorLabel = input.language === 'zh-CN' ? '原始错误' : 'Original error';
  const snapshotLabel = input.language === 'zh-CN' ? '最新页面快照' : 'Latest page snapshot';

  return [
    actionText,
    stageText,
    `${errorLabel}: ${input.errorMessage}`,
    guidance,
    `${snapshotLabel}:`,
    input.snapshot,
  ].join('\n\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
