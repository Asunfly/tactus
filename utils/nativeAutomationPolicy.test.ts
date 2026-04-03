import { describe, expect, it } from 'vitest';

import {
  createAutomationSessionState,
  isDangerousAutomationAction,
  normalizeAutomationSessionState,
} from './nativeAutomationPolicy';

describe('nativeAutomationPolicy', () => {
  it('creates a safe default session state', () => {
    expect(createAutomationSessionState()).toEqual({
      enabled: false,
      mode: 'default',
    });
  });

  it('normalizes legacy or partial values', () => {
    expect(normalizeAutomationSessionState(undefined)).toEqual({
      enabled: false,
      mode: 'default',
    });
    expect(normalizeAutomationSessionState({ enabled: true })).toEqual({
      enabled: true,
      mode: 'default',
    });
    expect(normalizeAutomationSessionState({ enabled: true, mode: 'yolo' })).toEqual({
      enabled: true,
      mode: 'yolo',
    });
  });

  it('marks browser_exec_js as dangerous', () => {
    expect(isDangerousAutomationAction('browser_exec_js', {}, null)).toBe(true);
  });

  it('marks browser_tabs close as dangerous', () => {
    expect(isDangerousAutomationAction('browser_tabs', { action: 'close' }, null)).toBe(true);
  });

  it('marks clicks on dangerous targets as dangerous', () => {
    expect(
      isDangerousAutomationAction(
        'browser_click',
        { index: 3 },
        '[3]<button aria-label=Delete order>Delete order />',
      ),
    ).toBe(true);
  });

  it('does not mark benign page actions as dangerous', () => {
    expect(
      isDangerousAutomationAction(
        'browser_click',
        { index: 1 },
        '[1]<button>Open detail />',
      ),
    ).toBe(false);
    expect(isDangerousAutomationAction('browser_input', { index: 1, text: 'Acme' }, null)).toBe(false);
    expect(isDangerousAutomationAction('browser_tabs', { action: 'new', url: 'https://example.com' }, null)).toBe(false);
  });
});
