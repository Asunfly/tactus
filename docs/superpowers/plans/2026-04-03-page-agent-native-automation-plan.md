# Page-Agent Native Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Tactus 主分支上落地基于 page-agent 执行层思路的扩展原生浏览器自动化第一版，支持当前窗口内跨标签页自动化工具调用。

**Architecture:** 复用 `@page-agent/page-controller` 作为单页 DOM 执行引擎，在 Tactus 中新增 background/content 通信链和 tab runtime，再通过内置 `browser_*` 函数工具接入现有 tool loop。首版先提供细粒度工具，不引入第二套 automation agent orchestration。

**Tech Stack:** WXT, Vue sidepanel, background/content scripts, `@page-agent/page-controller`, Vitest

---

### Task 1: 引入自动化共享模型与纯函数

**Files:**
- Create: `utils/nativeAutomationShared.ts`
- Test: `utils/nativeAutomationShared.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：
- 允许/阻止的 URL 判定
- tabs markdown 渲染
- tab action 参数归一化

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/nativeAutomationShared.test.ts`
Expected: FAIL，提示文件或导出不存在

- [ ] **Step 3: 写最小实现**

实现：
- `isNativeAutomationAllowedUrl`
- `renderNativeAutomationTabsMarkdown`
- `resolveNativeAutomationTabAction`

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- utils/nativeAutomationShared.test.ts`
Expected: PASS

### Task 2: 接入 page-controller 依赖

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 添加依赖**

新增：
- `@page-agent/page-controller`

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: lockfile 更新成功

### Task 3: 在 content script 中挂载 PageController 执行宿主

**Files:**
- Modify: `entrypoints/content.ts`

- [ ] **Step 1: 写失败测试或最小可验证目标**

以 `nativeAutomationShared` 纯函数测试为基础，本任务主要通过后续集成验证。

- [ ] **Step 2: 实现 content-side PAGE_CONTROL 处理**

新增能力：
- `get_browser_state`
- `update_tree`
- `clean_up_highlights`
- `click_element`
- `input_text`
- `select_option`
- `scroll`
- `scroll_horizontally`
- `execute_javascript`

实现要求：
- 懒加载 `PageController`
- 保留现有悬浮球/划词功能
- 仅响应 `AUTOMATION_PAGE_CONTROL`

- [ ] **Step 3: 做基础编译检查**

Run: `npm run compile`
Expected: PASS

### Task 4: 在 background 中增加自动化消息代理

**Files:**
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: 写失败测试或最小可验证目标**

本任务通过后续 sidepanel 集成和 compile 验证。

- [ ] **Step 2: 增加 TAB_CONTROL / PAGE_CONTROL 代理**

实现：
- `get_active_tab`
- `get_tab_info`
- `get_window_tabs`
- `open_new_tab`
- `close_tab`
- `activate_tab`
- PAGE_CONTROL 转发到目标 tab content script

- [ ] **Step 3: 编译检查**

Run: `npm run compile`
Expected: PASS

### Task 5: 新增 sidepanel 自动化运行时适配器

**Files:**
- Create: `utils/nativeAutomationRuntime.ts`
- Test: `utils/nativeAutomationRuntime.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：
- 当前目标 tab 解析
- 受限页面 fallback
- `browser_tabs` 的 `list/new/select/close` 状态流转

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/nativeAutomationRuntime.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现运行时适配器**

提供：
- `observe()`
- `click()`
- `input()`
- `selectOption()`
- `scroll()`
- `wait()`
- `executeJs()`
- `tabs(action, args)`

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- utils/nativeAutomationRuntime.test.ts`
Expected: PASS

### Task 6: 把内置 browser 工具接入现有 tool loop

**Files:**
- Modify: `utils/tools.ts`
- Modify: `entrypoints/sidepanel/App.vue`

- [ ] **Step 1: 写失败测试**

新增对工具定义与上下文提示的测试：
- 工具列表包含 `browser_observe`、`browser_click`、`browser_input`、`browser_select_option`、`browser_scroll`、`browser_wait`、`browser_exec_js`、`browser_tabs`

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/tools.native-automation.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

实现：
- 在 `availableTools` 中加入新工具
- 在 `getToolStatusText` / `generateContextPrompt` 中加入自动化提示
- 在 sidepanel `toolExecutor` 中接入 `nativeAutomationRuntime`

- [ ] **Step 4: 运行对应测试**

Run: `npm test -- utils/tools.native-automation.test.ts`
Expected: PASS

### Task 7: 文案与说明补齐

**Files:**
- Modify: `README.md`
- Modify: `README_ch.md`

- [ ] **Step 1: 补充文档**

说明：
- Tactus 现已具备内置浏览器自动化 runtime
- 不再要求本地 gateway 才能完成跨标签页自动化

- [ ] **Step 2: 运行基础校验**

Run: `npm run compile`
Expected: PASS

### Task 8: 统一验证

**Files:**
- No direct file changes required

- [ ] **Step 1: 运行新增单测**

Run: `npm test -- utils/nativeAutomationShared.test.ts utils/nativeAutomationRuntime.test.ts utils/tools.native-automation.test.ts`
Expected: PASS

- [ ] **Step 2: 运行全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: 运行类型检查**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add .
git commit -m "feat: add page-agent native automation runtime"
```
