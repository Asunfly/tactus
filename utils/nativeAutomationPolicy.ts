export type AutomationMode = 'default' | 'yolo';

export interface AutomationSessionState {
  enabled: boolean;
  mode: AutomationMode;
}

const DANGEROUS_CLICK_KEYWORDS = [
  'delete',
  'remove',
  'submit',
  'send',
  'pay',
  'purchase',
  'checkout',
  'confirm',
  'approve',
  'authorize',
  'trust',
  'execute',
  'run',
  'close account',
  'transfer',
  'unsubscribe',
  'cancel order',
  '删除',
  '移除',
  '提交',
  '发送',
  '支付',
  '购买',
  '结账',
  '确认',
  '批准',
  '授权',
  '信任',
  '执行',
  '运行',
  '转账',
  '注销',
  '取消订单',
];

export function createAutomationSessionState(): AutomationSessionState {
  return {
    enabled: false,
    mode: 'default',
  };
}

export function normalizeAutomationSessionState(
  value: Partial<AutomationSessionState> | null | undefined,
): AutomationSessionState {
  return {
    enabled: Boolean(value?.enabled),
    mode: value?.mode === 'yolo' ? 'yolo' : 'default',
  };
}

export function isDangerousAutomationAction(
  toolName: string,
  args: Record<string, unknown> | undefined,
  targetHint: string | null,
): boolean {
  if (toolName === 'browser_exec_js') {
    return true;
  }

  if (toolName === 'browser_tabs' && args?.action === 'close') {
    return true;
  }

  if (toolName === 'browser_click') {
    const normalizedHint = (targetHint || '').toLowerCase();
    return DANGEROUS_CLICK_KEYWORDS.some(keyword => normalizedHint.includes(keyword));
  }

  return false;
}
