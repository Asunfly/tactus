export type AutomationRiskLevel = 'low' | 'medium' | 'high';

export interface AutomationActionAssessment {
  toolName: string;
  summary: string;
  riskLevel: AutomationRiskLevel;
  requiresConfirmation: boolean;
  reason: string;
}

const highRiskKeywords = [
  'submit',
  'delete',
  'remove',
  'send',
  'confirm',
  'approve',
  'reject',
  'publish',
  'pay',
  'purchase',
  'order',
  'checkout',
  '提交',
  '删除',
  '移除',
  '发送',
  '确认',
  '同意',
  '拒绝',
  '发布',
  '支付',
  '付款',
  '下单',
  '结算',
];

function truncateText(value: unknown, maxLength = 48): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function pickTargetLabel(args: Record<string, any>): string {
  return truncateText(args.element)
    || truncateText(args.name)
    || truncateText(args.url)
    || truncateText(args.ref)
    || '当前页面';
}

function containsHighRiskKeyword(value: string): boolean {
  const normalized = value.toLowerCase();
  return highRiskKeywords.some(keyword => normalized.includes(keyword.toLowerCase()));
}

function buildSummary(toolName: string, args: Record<string, any>): string {
  const target = pickTargetLabel(args);
  switch (toolName) {
    case 'browser_click':
      return `点击 ${target}`;
    case 'browser_type':
      return `输入文本到 ${target}`;
    case 'browser_fill_form':
      return `批量填写表单 ${target}`;
    case 'browser_select_option':
      return `选择 ${target} 的选项`;
    case 'browser_drag':
      return `拖拽 ${truncateText(args.startElement) || '元素'} 到 ${truncateText(args.endElement) || '目标位置'}`;
    case 'browser_navigate':
      return `跳转到 ${target}`;
    case 'browser_handle_dialog':
      return args.accept ? '接受浏览器弹窗' : '取消浏览器弹窗';
    case 'browser_file_upload':
      return `上传文件到 ${target}`;
    case 'browser_press_key':
      return `按下按键 ${truncateText(args.key) || '未知键'}`;
    case 'browser_run_code':
      return '执行自定义 Playwright 代码';
    case 'browser_snapshot':
      return '读取当前页面快照';
    case 'browser_take_screenshot':
      return `截取 ${target}`;
    case 'browser_close':
      return '关闭当前标签页';
    default:
      return `执行 ${toolName}`;
  }
}

export function isPlaywrightBrowserTool(toolName: string): boolean {
  return toolName.startsWith('browser_');
}

export function assessAutomationAction(
  toolName: string,
  args: Record<string, any> = {},
): AutomationActionAssessment {
  const summary = buildSummary(toolName, args);
  const keywordSource = [args.element, args.name, args.url, args.ref, args.key]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  if (toolName === 'browser_handle_dialog' && args.accept) {
    return {
      toolName,
      summary,
      riskLevel: 'high',
      requiresConfirmation: true,
      reason: '高风险操作：接受浏览器弹窗通常意味着确认不可逆动作。',
    };
  }

  if (toolName === 'browser_run_code') {
    return {
      toolName,
      summary,
      riskLevel: 'high',
      requiresConfirmation: true,
      reason: '高风险操作：执行自定义 Playwright 代码会直接操控页面。',
    };
  }

  if (toolName === 'browser_click' && containsHighRiskKeyword(keywordSource)) {
    return {
      toolName,
      summary,
      riskLevel: 'high',
      requiresConfirmation: true,
      reason: '高风险操作：点击目标包含提交、删除、发送或支付等敏感关键词。',
    };
  }

  if (
    toolName === 'browser_click'
    || toolName === 'browser_navigate'
    || toolName === 'browser_drag'
    || toolName === 'browser_file_upload'
    || toolName === 'browser_close'
  ) {
    return {
      toolName,
      summary,
      riskLevel: 'medium',
      requiresConfirmation: false,
      reason: '中风险操作：会改变当前页面状态或浏览上下文。',
    };
  }

  return {
    toolName,
    summary,
    riskLevel: 'low',
    requiresConfirmation: false,
    reason: '低风险操作：读取页面信息或执行可预期的轻量交互。',
  };
}
