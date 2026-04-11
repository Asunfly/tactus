import { describe, expect, it } from 'vitest';

import {
  getPageControllerHighlightConfig,
  resolveSessionAutomationEnabled,
  shouldAllowBrowserAutomation,
  shouldShowBrowserAutomationEntry,
} from './browserAutomationSettings';

describe('browserAutomationSettings', () => {
  it('shows browser automation entry only when the global switch is enabled', () => {
    expect(shouldShowBrowserAutomationEntry(true)).toBe(true);
    expect(shouldShowBrowserAutomationEntry(false)).toBe(false);
  });

  it('allows browser automation only when both global and session switches are enabled', () => {
    expect(shouldAllowBrowserAutomation(true, true)).toBe(true);
    expect(shouldAllowBrowserAutomation(true, false)).toBe(false);
    expect(shouldAllowBrowserAutomation(false, true)).toBe(false);
    expect(shouldAllowBrowserAutomation(false, false)).toBe(false);
  });

  it('forces session automation state off when the global switch is disabled', () => {
    expect(resolveSessionAutomationEnabled(false, true)).toBe(false);
    expect(resolveSessionAutomationEnabled(true, true)).toBe(true);
  });

  it('maps disabled highlight mode to fully hidden page-agent highlight config', () => {
    expect(getPageControllerHighlightConfig(false)).toEqual({
      highlightOpacity: 0,
      highlightLabelOpacity: 0,
    });
  });

  it('maps enabled highlight mode to visible page-agent highlight config', () => {
    expect(getPageControllerHighlightConfig(true)).toEqual({
      highlightOpacity: 0,
      highlightLabelOpacity: 0.1,
    });
  });
});
