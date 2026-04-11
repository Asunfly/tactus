import { describe, expect, it } from 'vitest';

import { formatServerErrorMessage } from './serverErrorFormatting';

describe('serverErrorFormatting', () => {
  it('appends HTTP status for 5xx errors', () => {
    expect(formatServerErrorMessage('服务器内部错误，请稍后重试', 503)).toBe('服务器内部错误，请稍后重试（HTTP 503）');
  });

  it('keeps the original message for non-5xx or missing status', () => {
    expect(formatServerErrorMessage('服务器内部错误，请稍后重试', 400)).toBe('服务器内部错误，请稍后重试');
    expect(formatServerErrorMessage('服务器内部错误，请稍后重试', null)).toBe('服务器内部错误，请稍后重试');
  });
});
