# Browser Automation Visibility Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为浏览器自动化增加总开关与元素定位框开关，默认隐藏定位框，关闭总开关时隐藏侧边栏入口并强制禁用 `browser_*` 工具。

**Architecture:** 在 `utils/storage.ts` 增加两个 WXT storage 配置项，设置页负责展示与修改，侧边栏负责入口显隐和工具禁用，内容脚本根据高亮开关初始化/更新 `PageController` 可视高亮行为并清理残留。实现优先复用 `@page-agent/page-controller` 已提供的高亮配置，不增加额外 DOM hack。

**Tech Stack:** Vue 3、WXT、`@wxt-dev/storage`、Vitest、`@page-agent/page-controller`

---

### Task 1: 落地配置存储与单元测试

**Files:**
- Modify: `utils/storage.ts`
- Create: `utils/storage.browser-automation.test.ts`

- [ ] **Step 1: 写 storage 失败测试**

为两个新配置补测试：
- 默认值：`browserAutomationEnabled = true`
- 默认值：`browserAutomationHighlightEnabled = false`
- set/get 正常工作

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run utils/storage.browser-automation.test.ts`
Expected: FAIL，因为对应 getter/setter/watch 尚未实现。

- [ ] **Step 3: 在 `utils/storage.ts` 增加配置项**

新增：
- `browserAutomationEnabledStorage`
- `browserAutomationHighlightEnabledStorage`
- `get/set/watch` 三组导出函数

实现方式参考 WXT `storage.defineItem(...).watch(...)` 当前写法。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run utils/storage.browser-automation.test.ts`
Expected: PASS

### Task 2: 设置页接入两个开关

**Files:**
- Modify: `entrypoints/options/App.vue`
- Modify: `entrypoints/options/style.css`

- [ ] **Step 1: 写设置页状态/渲染失败测试或最小行为测试**

补一个设置页测试，至少覆盖：
- 初始加载两个开关值
- 交互切换后调用对应 setter

如果当前设置页缺少 DOM 测试基建，则写最小可维护测试，不强行重型化。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run entrypoints/options/*.test.ts utils/storage.browser-automation.test.ts`
Expected: 新增设置项相关断言失败。

- [ ] **Step 3: 实现设置页逻辑与 Professional 风格 UI**

在设置区域新增“浏览器自动化”分组：
- `启用浏览器自动化`
- `显示元素定位框`

要求：
- 文案清晰
- 布局沿用现有设置页模式
- 不新增花哨视觉，维持 Professional 风格

- [ ] **Step 4: 运行相关测试确认通过**

Run: `npx vitest run entrypoints/options/*.test.ts utils/storage.browser-automation.test.ts`
Expected: PASS

### Task 3: 侧边栏入口显隐与工具强失效

**Files:**
- Modify: `entrypoints/sidepanel/App.vue`
- Modify: `entrypoints/sidepanel/style.css`
- Modify: `utils/tools.native-automation.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：
- 总开关关闭时不显示自动化入口
- 总开关关闭时 `browser_*` 工具执行前被拦截
- 总开关关闭时历史会话 automation state 不恢复为可用状态

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run utils/tools.native-automation.test.ts`
Expected: FAIL，因为当前逻辑只看会话内状态，不看全局总开关。

- [ ] **Step 3: 实现侧边栏逻辑**

实现内容：
- 读取并监听 `browserAutomationEnabled`
- 控制 automation chip / modal 显隐
- 工具执行时优先检查总开关
- 总开关关闭时，把会话内自动化状态视为关闭

- [ ] **Step 4: 运行相关测试确认通过**

Run: `npx vitest run utils/tools.native-automation.test.ts`
Expected: PASS

### Task 4: 内容脚本隐藏定位框并清理残留

**Files:**
- Modify: `entrypoints/content.ts`
- Create: `utils/browserAutomationHighlightConfig.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：
- 默认关闭时 `PageController` 使用不可见高亮配置
- 开启时恢复可见配置
- 配置由开变关时会触发高亮清理逻辑

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run utils/browserAutomationHighlightConfig.test.ts`
Expected: FAIL，因为当前内容脚本只传 `enableMask/viewportExpansion`。

- [ ] **Step 3: 实现内容脚本配置接线**

实现内容：
- 初始化 `PageController` 时注入 `highlightOpacity` / `highlightLabelOpacity`
- 监听高亮配置变化
- 关闭时调用 `cleanUpHighlights()`
- 避免任务结束后旧高亮持续残留

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run utils/browserAutomationHighlightConfig.test.ts`
Expected: PASS

### Task 5: 回归自动化链路与现有测试

**Files:**
- Modify: `utils/nativeAutomationRuntime.test.ts`（如有必要）
- Modify: `utils/nativeAutomationExtension.test.ts`（如有必要）
- Modify: `utils/nativeAutomationShared.test.ts`（如有必要）

- [ ] **Step 1: 跑自动化相关单测回归**

Run: `npx vitest run utils/nativeAutomationExtension.test.ts utils/nativeAutomationRuntime.test.ts utils/nativeAutomationShared.test.ts utils/nativeAutomationPolicy.test.ts utils/tools.native-automation.test.ts utils/storage.browser-automation.test.ts utils/browserAutomationHighlightConfig.test.ts`

- [ ] **Step 2: 若失败则最小修复并重跑**

仅修复与本次改动直接相关的问题，不做无关重构。

- [ ] **Step 3: 确认自动化相关单测全部通过**

Expected: PASS

### Task 6: 冒烟测试与 E2E 验证

**Files:**
- Reuse existing E2E scripts in `.output/e2e` / repo scripts as applicable
- Modify repo files only if发现本次改动引出的真实缺陷

- [ ] **Step 1: 构建扩展**

Run: `npm run build`
Expected: PASS，输出更新到 `.output/chrome-mv3`

- [ ] **Step 2: 执行一次自动化冒烟测试**

优先使用现有自动化脚本或浏览器验证脚本，至少覆盖：
- 自动化总开关开启时入口可见
- 元素定位框默认不显示
- 打开新标签页并执行一次 `browser_observe`

- [ ] **Step 3: 执行一次完整 E2E 示例**

示例流程：
1. 打开 Google 搜索“在线表格工具”
2. 打开一个结果到新标签页
3. 切换到目标标签页
4. 再执行一次页面观察/点击

如果发现 bug，回到对应任务修复，再重跑本步骤。

- [ ] **Step 4: 记录验证结论**

在最终交付里明确说明：
- 跑了哪些单元测试
- 跑了哪组冒烟/E2E
- 是否重新构建完成

### Task 7: 交付手动测试产物

**Files:**
- Output only: `.output/chrome-mv3`

- [ ] **Step 1: 最终构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: 确认输出目录时间戳更新**

检查 `.output/chrome-mv3/manifest.json` 时间戳。

- [ ] **Step 3: 准备交付说明**

说明：
- 需要在 `chrome://extensions` 重新加载扩展
- 默认元素定位框应隐藏
- 若关闭总开关，侧边栏中不应出现自动化入口
