import { describe, expect, it } from 'vitest';
import {
  appendPlaywrightSnapshotHint,
  buildPlaywrightInteractionRecoveryMessage,
  buildPlaywrightStaleRefRecoveryMessage,
  collectPlaywrightToolRefs,
  findMissingPlaywrightSnapshotRefs,
  isPlaywrightInteractionTimeoutError,
  isPlaywrightMissingPageError,
  isPlaywrightRecoverableSessionError,
  isPlaywrightStaleRefError,
  shouldPreflightPlaywrightSnapshot,
  shouldSuggestLatestSnapshotHint,
} from './playwrightToolRecovery';

describe('playwrightToolRecovery', () => {
  it('提取单个 ref 参数', () => {
    expect(collectPlaywrightToolRefs('browser_click', {
      element: 'Submit',
      ref: 'e12',
    })).toEqual(['e12']);
  });

  it('提取拖拽和表单中的多个 ref 参数', () => {
    expect(collectPlaywrightToolRefs('browser_drag', {
      startRef: 'e10',
      endRef: 'e20',
    })).toEqual(['e10', 'e20']);

    expect(collectPlaywrightToolRefs('browser_fill_form', {
      fields: [
        { name: 'Name', ref: 'e1', value: 'Alice', type: 'textbox' },
        { name: 'Email', ref: 'e2', value: 'alice@example.com', type: 'textbox' },
        { name: 'Ignored', selector: '#id', value: 'x', type: 'textbox' },
      ],
    })).toEqual(['e1', 'e2']);
  });

  it('根据最新 snapshot 找出已失效的 ref', () => {
    const snapshot = `- button "Save" [ref=e1]
- textbox "Name" [ref=e2]`;

    expect(findMissingPlaywrightSnapshotRefs(snapshot, ['e1', 'e2'])).toEqual([]);
    expect(findMissingPlaywrightSnapshotRefs(snapshot, ['e1', 'e3'])).toEqual(['e3']);
  });

  it('识别 stale ref 报错和可恢复会话报错', () => {
    expect(isPlaywrightStaleRefError('Error: Ref e1621 not found in the current page snapshot. Try capturing new snapshot.')).toBe(true);
    expect(isPlaywrightStaleRefError('Error: browserType.connectOverCDP: Target page, context or browser has been closed')).toBe(false);

    expect(isPlaywrightRecoverableSessionError('Error: browserContext.newPage: Target page, context or browser has been closed')).toBe(true);
    expect(isPlaywrightRecoverableSessionError('Extension disconnected: undefined')).toBe(true);
    expect(isPlaywrightRecoverableSessionError('工具调用失败: Failed to fetch')).toBe(true);
    expect(isPlaywrightRecoverableSessionError('Error: Ref e1621 not found in the current page snapshot. Try capturing new snapshot.')).toBe(false);
  });

  it('识别应该交还给模型重新判断的交互超时错误', () => {
    expect(isPlaywrightInteractionTimeoutError('TimeoutError: locator.click: Timeout 5000ms exceeded.')).toBe(true);
    expect(isPlaywrightInteractionTimeoutError('subtree intercepts pointer events')).toBe(true);
    expect(isPlaywrightInteractionTimeoutError('Extension disconnected: undefined')).toBe(false);
  });

  it('识别需要先补 tab 的 missing page 错误', () => {
    expect(isPlaywrightMissingPageError('Error: browserContext.newPage: Target page, context or browser has been closed')).toBe(true);
    expect(isPlaywrightMissingPageError('No open pages available.')).toBe(true);
    expect(isPlaywrightMissingPageError('Extension disconnected: undefined')).toBe(false);
  });

  it('只对带 ref 的工具启用 snapshot 预检', () => {
    expect(shouldPreflightPlaywrightSnapshot('browser_click', { ref: 'e1' })).toBe(true);
    expect(shouldPreflightPlaywrightSnapshot('browser_fill_form', { fields: [{ ref: 'e1' }] })).toBe(true);
    expect(shouldPreflightPlaywrightSnapshot('browser_snapshot', {})).toBe(false);
    expect(shouldPreflightPlaywrightSnapshot('browser_navigate', { url: 'https://example.com' })).toBe(false);
  });

  it('为交互工具补充最新 snapshot 提示', () => {
    expect(shouldSuggestLatestSnapshotHint('browser_click')).toBe(true);
    expect(shouldSuggestLatestSnapshotHint('browser_snapshot')).toBe(false);

    expect(appendPlaywrightSnapshotHint('browser_click', 'Action done', 'zh-CN')).toContain('仅使用上面最新页面快照中的 ref');
    expect(appendPlaywrightSnapshotHint('browser_snapshot', 'Snapshot', 'zh-CN')).toBe('Snapshot');
  });

  it('生成给模型继续决策的 stale ref 恢复文案', () => {
    const message = buildPlaywrightStaleRefRecoveryMessage({
      toolName: 'browser_click',
      staleRefs: ['e1621'],
      snapshot: '- button "Retry" [ref=e200]',
      language: 'zh-CN',
      stage: 'preflight',
    });

    expect(message).toContain('browser_click 未执行');
    expect(message).toContain('e1621');
    expect(message).toContain('ref=e200');
  });

  it('生成给模型重新判断页面状态的交互超时恢复文案', () => {
    const message = buildPlaywrightInteractionRecoveryMessage({
      toolName: 'browser_click',
      errorMessage: 'TimeoutError: locator.click: Timeout 5000ms exceeded.',
      snapshot: '- button "Retry" [ref=e200]',
      language: 'zh-CN',
      stage: 'timeout',
    });

    expect(message).toContain('browser_click 未执行成功');
    expect(message).toContain('TimeoutError');
    expect(message).toContain('ref=e200');
  });
});
