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
    highlightOpacity: 0.1,
    highlightLabelOpacity: 0.1,
  };
}

export function getPageAgentHighlightVisibilityCss(highlightEnabled: boolean): string {
  if (highlightEnabled) {
    return '';
  }

  return `
#playwright-highlight-container {
  pointer-events: none !important;
}

#playwright-highlight-container .playwright-highlight-label {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  color: transparent !important;
  background: transparent !important;
  box-shadow: none !important;
  border: 0 !important;
  text-shadow: none !important;
}
`;
}
