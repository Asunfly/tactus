import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNativeAutomationBridge } from './nativeAutomationExtension';

describe('createNativeAutomationBridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries page control when the content script receiver is not ready yet', async () => {
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage');
    (sendMessage as any)
      .mockResolvedValueOnce({ success: false, error: 'Could not establish connection. Receiving end does not exist.' })
      .mockResolvedValueOnce({ success: false, error: 'Could not establish connection. Receiving end does not exist.' })
      .mockResolvedValueOnce({
        success: true,
        url: 'https://example.com',
        title: 'Example',
        header: 'Header',
        content: 'Content',
        footer: 'Footer',
      });

    const bridge = createNativeAutomationBridge();
    const result = await bridge.getBrowserState(12);

    expect(result.title).toBe('Example');
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'AUTOMATION_PAGE_CONTROL',
      action: 'get_browser_state',
      targetTabId: 12,
    });
  });

  it('fails after exhausting retries for a missing receiver', async () => {
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage');
    (sendMessage as any).mockResolvedValue({ success: false, error: 'Could not establish connection. Receiving end does not exist.' });

    const bridge = createNativeAutomationBridge();

    await expect(bridge.getBrowserState(12)).rejects.toThrow('Could not establish connection. Receiving end does not exist.');
    expect(sendMessage).toHaveBeenCalledTimes(4);
  });
});
