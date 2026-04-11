import { describe, expect, it } from 'vitest';

import {
  getBrowserAutomationEnabled,
  getBrowserAutomationHighlightEnabled,
  getBrowserAutomationMaxIterations,
  getBrowserAutomationPageReadyTimeoutMs,
  getModelRequestMaxRetries,
  setBrowserAutomationEnabled,
  setBrowserAutomationHighlightEnabled,
  setBrowserAutomationMaxIterations,
  setBrowserAutomationPageReadyTimeoutMs,
  setModelRequestMaxRetries,
} from './storage';

describe('browser automation storage settings', () => {
  it('defaults browser automation to enabled', async () => {
    expect(await getBrowserAutomationEnabled()).toBe(true);
  });

  it('defaults element highlight to disabled', async () => {
    expect(await getBrowserAutomationHighlightEnabled()).toBe(false);
  });

  it('persists browser automation enabled changes', async () => {
    await setBrowserAutomationEnabled(false);
    expect(await getBrowserAutomationEnabled()).toBe(false);
    await setBrowserAutomationEnabled(true);
    expect(await getBrowserAutomationEnabled()).toBe(true);
  });

  it('persists browser automation highlight changes', async () => {
    await setBrowserAutomationHighlightEnabled(true);
    expect(await getBrowserAutomationHighlightEnabled()).toBe(true);
    await setBrowserAutomationHighlightEnabled(false);
    expect(await getBrowserAutomationHighlightEnabled()).toBe(false);
  });

  it('defaults automation tuning values', async () => {
    expect(await getBrowserAutomationMaxIterations()).toBe(20);
    expect(await getBrowserAutomationPageReadyTimeoutMs()).toBe(7000);
    expect(await getModelRequestMaxRetries()).toBe(5);
  });

  it('normalizes automation tuning values into safe ranges', async () => {
    await setBrowserAutomationMaxIterations(200);
    await setBrowserAutomationPageReadyTimeoutMs(500);
    await setModelRequestMaxRetries(99);

    expect(await getBrowserAutomationMaxIterations()).toBe(100);
    expect(await getBrowserAutomationPageReadyTimeoutMs()).toBe(1000);
    expect(await getModelRequestMaxRetries()).toBe(10);
  });
});
