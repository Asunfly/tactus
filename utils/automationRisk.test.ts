import { describe, expect, it } from 'vitest';
import { assessAutomationAction, isPlaywrightBrowserTool } from './automationRisk';

describe('isPlaywrightBrowserTool', () => {
  it('识别 browser_ 前缀工具', () => {
    expect(isPlaywrightBrowserTool('browser_click')).toBe(true);
    expect(isPlaywrightBrowserTool('browser_snapshot')).toBe(true);
  });

  it('忽略非 Playwright 浏览器工具', () => {
    expect(isPlaywrightBrowserTool('get_page_info')).toBe(false);
    expect(isPlaywrightBrowserTool('mcp__local__search_docs')).toBe(false);
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
  });

  it('将普通文本输入识别为低风险', () => {
    const result = assessAutomationAction('browser_type', {
      element: '姓名输入框',
      text: '张三',
    });

    expect(result.riskLevel).toBe('low');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('将页面跳转识别为中风险', () => {
    const result = assessAutomationAction('browser_navigate', {
      url: 'https://example.com/orders',
    });

    expect(result.riskLevel).toBe('medium');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('自愈回合中会要求中风险浏览器动作二次确认', () => {
    const result = assessAutomationAction('browser_navigate', {
      url: 'https://example.com/orders',
    }, {
      inSelfHealMode: true,
    });

    expect(result.riskLevel).toBe('medium');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('自愈回合中重新执行脚本会要求二次确认', () => {
    const result = assessAutomationAction('execute_skill_script', {
      skill_name: 'demo-skill',
      script_path: 'scripts/run.js',
    }, {
      inSelfHealMode: true,
    });

    expect(result.riskLevel).toBe('high');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.summary).toContain('重新执行脚本');
  });

  it('读取 Skill 文件保持低风险', () => {
    const result = assessAutomationAction('read_skill_file', {
      skill_name: 'demo-skill',
      file_path: 'references/guide.md',
    }, {
      inSelfHealMode: true,
    });

    expect(result.riskLevel).toBe('low');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('将接受浏览器弹窗识别为高风险', () => {
    const result = assessAutomationAction('browser_handle_dialog', {
      accept: true,
    });

    expect(result.riskLevel).toBe('high');
    expect(result.requiresConfirmation).toBe(true);
  });
});
