export type AutomationRiskLevel = 'low' | 'medium' | 'high';

export interface AutomationActionAssessment {
  toolName: string;
  summary: string;
  riskLevel: AutomationRiskLevel;
  requiresConfirmation: boolean;
  reason: string;
}

export interface AutomationAssessmentOptions {
  inSelfHealMode?: boolean;
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
  'commit',
  'execute',
  'run',
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
  '执行',
  '运行',
];

function truncateText(value: unknown, maxLength = 48): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function normalizeToolName(toolName: string): string {
  if (!toolName.startsWith('mcp__')) {
    return toolName;
  }

  const parts = toolName.split('__');
  return parts.length >= 3 ? parts.slice(2).join('__') : toolName;
}

function pickTargetLabel(args: Record<string, any>): string {
  return truncateText(args.element)
    || truncateText(args.name)
    || truncateText(args.url)
    || truncateText(args.ref)
    || truncateText(args.script_path)
    || '当前目标';
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
    case 'extract_page_content':
      return '提取当前页面内容';
    case 'activate_skill':
      return `激活 Skill ${truncateText(args.skill_name) || ''}`.trim();
    case 'execute_skill_script':
      return `执行脚本 ${truncateText(args.script_path) || target}`;
    case 'read_skill_file':
      return `读取文件 ${truncateText(args.file_path) || target}`;
    default:
      return `执行 ${toolName}`;
  }
}

export function isPlaywrightBrowserTool(toolName: string): boolean {
  return normalizeToolName(toolName).startsWith('browser_');
}

export function assessAutomationAction(
  toolName: string,
  args: Record<string, any> = {},
  options: AutomationAssessmentOptions = {},
): AutomationActionAssessment {
  const normalizedToolName = normalizeToolName(toolName);
  const inSelfHealMode = options.inSelfHealMode ?? false;
  const summary = buildSummary(normalizedToolName, args);
  const keywordSource = [
    normalizedToolName,
    args.element,
    args.name,
    args.url,
    args.ref,
    args.key,
    args.script_path,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  if (normalizedToolName === 'execute_skill_script') {
    return {
      toolName,
      summary: inSelfHealMode
        ? `重新执行脚本 ${truncateText(args.script_path) || '当前脚本'}`
        : summary,
      riskLevel: 'high',
      requiresConfirmation: inSelfHealMode,
      reason: inSelfHealMode
        ? '高风险操作：当前处于自愈回合，重新执行脚本可能重复产生页面副作用，需要再次确认。'
        : '高风险操作：Skill 脚本可以直接修改页面状态或触发提交流程。',
    };
  }

  if (
    normalizedToolName === 'extract_page_content'
    || normalizedToolName === 'activate_skill'
    || normalizedToolName === 'read_skill_file'
    || normalizedToolName === 'browser_snapshot'
    || normalizedToolName === 'browser_console_messages'
    || normalizedToolName === 'browser_network_requests'
  ) {
    return {
      toolName,
      summary,
      riskLevel: 'low',
      requiresConfirmation: false,
      reason: '低风险操作：只读取上下文或执行可预期的轻量操作。',
    };
  }

  if (normalizedToolName === 'browser_handle_dialog' && args.accept) {
    return {
      toolName,
      summary,
      riskLevel: 'high',
      requiresConfirmation: true,
      reason: inSelfHealMode
        ? '高风险操作：当前处于自愈回合，再次接受弹窗可能重复确认不可逆动作。'
        : '高风险操作：接受浏览器弹窗通常意味着确认不可逆动作。',
    };
  }

  if (normalizedToolName === 'browser_run_code') {
    return {
      toolName,
      summary,
      riskLevel: 'high',
      requiresConfirmation: true,
      reason: inSelfHealMode
        ? '高风险操作：当前处于自愈回合，重新执行自定义代码可能重复产生副作用。'
        : '高风险操作：执行自定义 Playwright 代码会直接操控页面。',
    };
  }

  if (normalizedToolName === 'browser_click' && containsHighRiskKeyword(keywordSource)) {
    return {
      toolName,
      summary,
      riskLevel: 'high',
      requiresConfirmation: true,
      reason: inSelfHealMode
        ? '高风险操作：当前处于自愈回合，再次点击高风险目标可能造成重复提交、删除或支付。'
        : '高风险操作：点击目标包含提交、删除、发送或支付等敏感关键词。',
    };
  }

  if (
    normalizedToolName === 'browser_click'
    || normalizedToolName === 'browser_navigate'
    || normalizedToolName === 'browser_drag'
    || normalizedToolName === 'browser_file_upload'
    || normalizedToolName === 'browser_close'
  ) {
    return {
      toolName,
      summary,
      riskLevel: 'medium',
      requiresConfirmation: inSelfHealMode,
      reason: inSelfHealMode
        ? '中风险操作：当前处于自愈回合，重新执行会再次改变页面状态，需要二次确认。'
        : '中风险操作：会改变当前页面状态或浏览上下文。',
    };
  }

  if (containsHighRiskKeyword(keywordSource)) {
    return {
      toolName,
      summary,
      riskLevel: 'high',
      requiresConfirmation: true,
      reason: inSelfHealMode
        ? '高风险操作：当前处于自愈回合，再次执行带有敏感语义的工具可能导致重复副作用。'
        : '高风险操作：工具名或目标包含敏感关键词。',
    };
  }

  return {
    toolName,
    summary,
    riskLevel: 'low',
    requiresConfirmation: false,
    reason: '低风险操作：只读取上下文或执行可预期的轻量操作。',
  };
}
