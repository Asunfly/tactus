# Tactus Page-Agent Native Automation Design

## Goal

在 Tactus 扩展内部实现跨标签页浏览器自动化能力，让现有对话式 agent 可以直接调用自动化工具完成多页面任务，不再依赖本地 Playwright gateway / bridge。

## Why This Route

经过对比：

- 现有 Playwright gateway 方案能力强，但链路重，状态同步复杂，已经出现 bridge 失活、30 秒超时、blank tab 放大等问题。
- Claude in Chrome / Computer Use 方案更偏 Anthropic 专属执行栈，权限重、绑定深，不适合作为 Tactus 的长期基座。
- `page-agent` 证明了一个更贴近浏览器扩展产品形态的路线：把执行层放在扩展内部，通过 content script + background + tab controller 完成跨页面操作。

但 `page-agent` 的 `LLM` / `PageAgentCore` 只支持 OpenAI-compatible 模型接口，与 Tactus 当前同时支持 OpenAI compatible、Anthropic、Gemini 的 provider 体系不匹配。因此本方案只复用它的 **执行架构和页面控制模式**，不直接复用它的 LLM/agent core。

## Principles

1. **扩展原生优先**
   浏览器自动化执行必须运行在扩展内部，不依赖本地 Node 进程或外部 gateway。

2. **保留 Tactus 的 agent 宿主层**
   对话、provider、tool loop、sidepanel 产品体验继续由 Tactus 负责。

3. **执行引擎与工具协议解耦**
   底层先做统一 native automation runtime，上层再逐步提供高层任务入口和细粒度工具入口。

4. **Chrome 优先，但不锁死未来**
   第一阶段优先完成 Chrome 能跑通的跨标签页自动化；Firefox 不在首版承诺范围，但模块边界要为后续降级/扩展留口。

5. **避免再次推翻路线**
   不直接把 `page-agent` UI、MCP、hub、LLM client 接进来，只吸收可长期保留的执行层能力。

## Target Architecture

### 1. Tactus Agent Layer

已有的 Tactus sidepanel 对话和 tool loop 继续作为唯一的 agent 宿主。模型通过内置函数工具决定是否发起自动化动作。

### 2. Automation Facade Layer

新增一层 Tactus 自己的自动化接口，对上暴露一致的工具协议。

首阶段提供细粒度工具：

- `browser_observe`
- `browser_click`
- `browser_input`
- `browser_select_option`
- `browser_scroll`
- `browser_wait`
- `browser_exec_js`
- `browser_tabs`

未来可在同一层补高层任务入口，如 `automation_execute_task(task)`，但这不是第一阶段强依赖项。

### 3. Native Automation Runtime

这是核心执行层，参考 `page-agent` 拆成三个职责：

- `Page Runtime`
  负责单页 DOM 提取、元素索引、动作执行。
  实现方式：直接复用 `@page-agent/page-controller`。

- `Tab Runtime`
  负责当前窗口内 tab 的发现、选择、打开、关闭、基本状态跟踪。
  实现方式：借鉴 `page-agent` 的 `TabsController` 思路，但按 Tactus 自己的工具协议重写，避免引入它的 tab group / hub /外部 API 绑定。

- `Automation Session`
  负责“当前自动化目标 tab”状态、工具调用间的 target 继承、非法页面回退策略。

### 4. Execution Transport

扩展内部链路采用：

- sidepanel -> background
- background -> content script

首版不依赖 main-world 注入，不依赖 `chrome.debugger`，因为 `@page-agent/page-controller` 在 content script 中已经能完成 DOM 观察与交互。

如后续遇到特定站点需要 main-world 事件兼容，再单独增加注入桥，不作为首版前提。

## First-Phase Capability Boundary

### In Scope

- 当前窗口内多标签页自动化
- 基于 DOM 文本和元素索引的观察/点击/输入/选择/滚动
- 打开新标签页、切换标签页、关闭非当前初始标签页
- 在 tool loop 中跨多轮维持当前自动化目标 tab
- 对受限页面给出明确阻塞提示，而不是误打开 blank tab

### Out of Scope

- 本地 gateway / Playwright / CDP relay
- screenshot-first 或坐标级 computer use
- 控制台/网络请求/CDP 深层能力
- Firefox 首版完整支持
- page-agent 的 hub tab / MCP server / page JS 暴露 API
- 独立的 second-agent automation LLM

## Why Start With Fine-Grained Tools

虽然整体架构是“双层”，但首版实际落地先从细粒度工具开始，原因是：

1. Tactus 当前已经有成熟的 tool loop 和多 provider 支持。
2. 如果先做高层 `execute_task(task)`，就必须引入第二套 automation LLM orchestration，而这会和 Tactus 自身的 agent 层重叠。
3. 先把 native automation runtime 做成细粒度工具，更容易复用现有架构，也更利于验证页面控制层是否稳定。

后续如果需要高层自动执行任务能力，可以在同一 runtime 之上增加 orchestration，而不是重写底层。

## Key Differences From Previous Playwright Branch

- 不再维护 `playwright-mcp` 子进程。
- 不再维护 `relayRuntime` / bridge websocket / gateway health 状态。
- 不再用 Playwright snapshot/ref 协议。
- 改为直接返回 `page-agent` 风格的文本化浏览器状态和元素索引。
- tab 管理由 Tactus 自己维护，不再映射 `targetId/sessionId/tabId`。

## UI / Product Surface

首版不新增复杂配置面板。

- 自动化直接使用当前激活的 Tactus provider 配置。
- 工具对用户仍表现为普通对话中的自动化动作，不新增独立的 automation 模式。
- 如遇当前 provider 不适合自动化工具调用，由上层 tool loop 自然失败，不引入额外 provider gating。

## Risks

1. `@page-agent/page-controller` 在内容脚本环境下对复杂前端框架的兼容性仍需实测。
2. DOM 文本索引模式对动态页面的鲁棒性可能弱于 Playwright。
3. 某些页面可能需要 main-world 才能触发框架内部事件。
4. 当前主分支没有现成的 tool supervisor/self-healing 层，首版需控制复杂度，先把执行路径跑通。

## Success Criteria

完成后，Tactus 在 Chrome 中应能做到：

1. 模型通过内置工具读取当前页面的可交互元素状态。
2. 模型可以在同一请求内打开新标签页、切换标签页并继续操作。
3. 对受限页面不会无意义地新建 `about:blank`，而是返回明确错误。
4. 整条执行链路不依赖本地服务和 Playwright。
