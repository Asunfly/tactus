import { describe, expect, it } from 'vitest';

import { rollbackToolIterationMessages, shouldContinueAfterToolResult } from './toolResultPolicy';

describe('toolResultPolicy', () => {
  it('continues the tool loop even when a browser tool returns failure', () => {
    expect(shouldContinueAfterToolResult({
      tool_call_id: '1',
      name: 'browser_exec_js',
      result: '无法执行页面脚本',
      success: false,
    })).toBe(true);
  });

  it('continues the tool loop when a browser tool succeeds', () => {
    expect(shouldContinueAfterToolResult({
      tool_call_id: '1',
      name: 'browser_click',
      result: 'ok',
      success: true,
    })).toBe(true);
  });

  it('keeps non-browser tool failures on the retry path', () => {
    expect(shouldContinueAfterToolResult({
      tool_call_id: '1',
      name: 'execute_skill_script',
      result: '脚本执行失败',
      success: false,
    })).toBe(false);
  });

  it('rolls back assistant tool-call context together with any appended tool results', () => {
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'user' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tool-1' }] },
      { role: 'tool', content: 'tool ok', tool_call_id: 'tool-1', name: 'extract_page_content' },
    ];

    expect(rollbackToolIterationMessages(messages, 2)).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'user' },
    ]);
  });
});
