import { describe, expect, it } from 'vitest';
import { assessAutomationAction, isPlaywrightBrowserTool } from './automationRisk';

describe('isPlaywrightBrowserTool', () => {
  it('识别 browser_ 前缀工具', () => {
    expect(isPlaywrightBrowserTool('browser_click')).toBe(true);
    expect(isPlaywrightBrowserTool('browser_snapshot')).toBe(true);
  });

  it('忽略非 Playwright 浏览器工具', () => {
    expect(isPlaywrightBrowserTool('get_page_info')).toBe(false);
    expect(isPlaywrightBrowserTool('mcp__local__browser_click')).toBe(false);
  });
});

describe('assessAutomationAction', () => {
  it('将包含提交关键词的点击识别为高风险', () => {
    const result = assessAutomationAction('browser_click', {
      element: '提交申请按钮',
      ref: 'btn-submit',
    });

    expect(result.riskLevel).toBe('high');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.summary).toContain('提交申请按钮');
    expect(result.reason).toContain('高风险');
  });

  it('将普通文本输入识别为低风险', () => {
    const result = assessAutomationAction('browser_type', {
      element: '姓名输入框',
      text: '张三',
    });

    expect(result.riskLevel).toBe('low');
    expect(result.requiresConfirmation).toBe(false);
    expect(result.summary).toContain('姓名输入框');
  });

  it('将页面跳转识别为中风险', () => {
    const result = assessAutomationAction('browser_navigate', {
      url: 'https://example.com/orders',
    });

    expect(result.riskLevel).toBe('medium');
    expect(result.requiresConfirmation).toBe(false);
    expect(result.summary).toContain('example.com/orders');
  });

  it('将普通点击识别为中风险', () => {
    const result = assessAutomationAction('browser_click', {
      element: '展开详情按钮',
      ref: 'expand-detail',
    });

    expect(result.riskLevel).toBe('medium');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('将接受浏览器弹窗识别为高风险', () => {
    const result = assessAutomationAction('browser_handle_dialog', {
      accept: true,
    });

    expect(result.riskLevel).toBe('high');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.summary).toContain('接受');
  });
});
