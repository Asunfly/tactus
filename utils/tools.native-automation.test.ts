import { describe, expect, it } from 'vitest';

import { generateContextPrompt, getFilteredTools } from './tools';

describe('native automation tools', () => {
  it('includes built-in browser automation tools', () => {
    const tools = getFilteredTools({ sharePageContent: false, skills: [], mcpTools: [], automationEnabled: true });
    const names = tools.map(tool => tool.function.name);

    expect(names).toContain('browser_observe');
    expect(names).toContain('browser_click');
    expect(names).toContain('browser_input');
    expect(names).toContain('browser_select_option');
    expect(names).toContain('browser_scroll');
    expect(names).toContain('browser_wait');
    expect(names).toContain('browser_exec_js');
    expect(names).toContain('browser_tabs');
  });

  it('adds automation guidance to the context prompt', () => {
    const prompt = generateContextPrompt({
      sharePageContent: false,
      skills: [],
      mcpTools: [],
      language: 'zh-CN',
      automationEnabled: true,
    });

    expect(prompt).toContain('browser_observe');
    expect(prompt).toContain('browser_tabs');
  });

  it('hides automation tools when automation is disabled', () => {
    const tools = getFilteredTools({ sharePageContent: false, skills: [], mcpTools: [], automationEnabled: false });
    const names = tools.map(tool => tool.function.name);

    expect(names).not.toContain('browser_observe');
    expect(names).not.toContain('browser_tabs');
  });

  it('keeps browser tools hidden when the global automation switch forces the session off', () => {
    const tools = getFilteredTools({ sharePageContent: false, skills: [], mcpTools: [], automationEnabled: false });
    const names = tools.map(tool => tool.function.name);

    expect(names).not.toContain('browser_click');
    expect(names).not.toContain('browser_exec_js');
  });

  it('tells the model to omit browser_scroll index for page scrolling', () => {
    const tools = getFilteredTools({ sharePageContent: false, skills: [], mcpTools: [], automationEnabled: true });
    const scrollTool = tools.find(tool => tool.function.name === 'browser_scroll');
    const indexDescription = scrollTool?.function.parameters.properties.index.description;

    expect(indexDescription).toContain('普通页面滚动请省略');
  });
});
