import { describe, expect, it } from 'vitest';
import { formatBuildMeta } from './buildInfo';

describe('buildInfo', () => {
  it('在同时有版本号和构建时间时输出完整标签', () => {
    expect(formatBuildMeta('1.3.1', '2026-03-30 15:31:22')).toBe(
      'v1.3.1 · 构建于 2026-03-30 15:31:22',
    );
  });

  it('缺少构建时间时给出清晰降级文案', () => {
    expect(formatBuildMeta('1.3.1', '')).toBe('v1.3.1 · 未注入构建时间');
  });
});
