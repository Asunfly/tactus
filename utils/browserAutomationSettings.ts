export function shouldShowBrowserAutomationEntry(globalEnabled: boolean): boolean {
  return globalEnabled;
}

export function shouldAllowBrowserAutomation(globalEnabled: boolean, sessionEnabled: boolean): boolean {
  return globalEnabled && sessionEnabled;
}

export function resolveSessionAutomationEnabled(globalEnabled: boolean, sessionEnabled: boolean): boolean {
  return globalEnabled ? sessionEnabled : false;
}

export function getPageControllerHighlightConfig(highlightEnabled: boolean): {
  highlightOpacity: number;
  highlightLabelOpacity: number;
} {
  if (!highlightEnabled) {
    return {
      highlightOpacity: 0,
      highlightLabelOpacity: 0,
    };
  }

  return {
    highlightOpacity: 0,
    highlightLabelOpacity: 0.1,
  };
}
