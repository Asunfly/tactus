# Playwright Runtime State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前分散在 sidepanel / executor / bridge 接线中的 Playwright 生命周期恢复逻辑收口为一个 deterministic runtime 状态机，让 runtime 自己兜住 target 丢失、跨窗口切换、gateway 重连和导航恢复。

**Architecture:** 新增独立的 `PlaywrightRuntimeController`，由它统一维护 `idle / ready / recovering / blocked / degraded` 状态，并提供“执行前准备”“会话错误恢复”“tab 生命周期操作”三类能力。`App.vue` 不再自己拼恢复动作，只负责把 browser API、MCP reconnect 和当前语言等依赖注入给 controller；`playwrightToolExecutor` 只跟 controller 交互，不再感知零散回调。

**Tech Stack:** Vue 3 sidepanel, WXT, TypeScript, Vitest, browser extension APIs, Playwright MCP gateway

---

### Task 1: 抽离 runtime 状态机模型与 controller 测试

**Files:**
- Create: `utils/playwrightRuntimeController.ts`
- Create: `utils/playwrightRuntimeController.test.ts`
- Modify: `utils/playwrightBridgeCoverage.test.ts`

- [ ] **Step 1: 写失败测试，锁定 runtime 状态与恢复语义**

覆盖至少这些场景：
- 已有绑定 tab 时进入 `ready`
- 当前窗口无目标但其它窗口有网页 tab 时，自动切换并聚焦，进入 `ready`
- `browser_navigate(url)` 在无可恢复网页目标时，直接打开目标 URL，进入 `ready`
- 非导航类工具在无可恢复网页目标时，进入 `blocked`
- `about:blank`/内部页 target 进入 `degraded`，不直接放业务动作过去
- session/page/context 错误时进入 `recovering`，恢复后回到 `ready`

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- utils/playwrightRuntimeController.test.ts`
Expected: FAIL，提示 controller/状态转移尚未实现

- [ ] **Step 3: 实现最小 controller**

实现内容：
- `PlaywrightRuntimePhase`
- `PlaywrightRuntimeSnapshot`
- `prepareForTool(toolName, toolArgs)`
- `recoverForSessionError(toolName, toolArgs, errorMessage)`
- `listTabs() / createTab() / selectTab() / closeTab()` 所需的最小运行时封装

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- utils/playwrightRuntimeController.test.ts`
Expected: PASS

### Task 2: 用 controller 替换 sidepanel 内零散生命周期逻辑

**Files:**
- Modify: `entrypoints/sidepanel/App.vue`
- Modify: `utils/playwrightRuntimeController.ts`
- Modify: `utils/playwrightRuntimeController.test.ts`

- [ ] **Step 1: 写失败测试，锁定 App.vue 对 runtime controller 的接入点**

至少覆盖：
- `ensureInternalBridgeForTool` 改为走 controller
- `recoverMissingPage` 改为走 controller
- `browser_tabs` 相关动作能更新 runtime 的 bound target

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- utils/playwrightRuntimeController.test.ts utils/playwrightBridgeCoverage.test.ts`
Expected: FAIL，提示旧回调签名/旧恢复路径不再满足预期

- [ ] **Step 3: 最小改造 sidepanel**

实现内容：
- 在 `App.vue` 中创建单例 `PlaywrightRuntimeController`
- 将 tab 查询、tab 激活、tab 创建、window 聚焦、bridge 绑定、gateway reconnect 都通过依赖注入交给 controller
- 移除 `App.vue` 内散落的 deterministic 恢复分支，只保留 tabs facade 的展示拼装

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- utils/playwrightRuntimeController.test.ts utils/playwrightBridgeCoverage.test.ts`
Expected: PASS

### Task 3: 让 playwright executor 只通过 runtime controller 恢复生命周期错误

**Files:**
- Modify: `utils/playwrightToolExecutor.ts`
- Modify: `utils/playwrightToolExecutor.test.ts`
- Modify: `utils/playwrightBridgeCoverage.test.ts`

- [ ] **Step 1: 写失败测试，锁定 executor-runtime 协议**

至少覆盖：
- 执行前准备走 `prepareForTool`
- `browserContext.newPage` / `Target page...closed` / transport 类错误走 `recoverForSessionError`
- stale ref / timeout 仍保留现有 snapshot 恢复，不被状态机吞掉

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- utils/playwrightToolExecutor.test.ts utils/playwrightBridgeCoverage.test.ts`
Expected: FAIL，提示旧 callback 依赖不再匹配

- [ ] **Step 3: 实现 executor 接线**

实现内容：
- 用 `runtimeController.prepareForTool` 替代 `ensureInternalBridgeForTool`
- 用 `runtimeController.recoverForSessionError` 替代 `recoverMissingPage + ensureInternalGatewayReady + reconnectServer` 的拼接
- 保持 `browser_tabs` 旁路和 snapshot 相关恢复逻辑不变

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- utils/playwrightToolExecutor.test.ts utils/playwrightBridgeCoverage.test.ts utils/toolExecutionSupervisor.test.ts utils/toolLoopState.test.ts utils/providerLoops.test.ts`
Expected: PASS

### Task 4: 完整验证与人工回归支持

**Files:**
- Modify: `docs/superpowers/specs/2026-03-28-agent-self-healing-supervisor-design.md`
- Modify: `docs/superpowers/specs/2026-03-26-internal-playwright-bridge-design.md`

- [ ] **Step 1: 运行完整构建与关键测试**

Run: `npm test -- utils/playwrightRuntimeController.test.ts utils/playwrightRuntimeExecutorIntegration.test.ts utils/playwrightToolExecutor.test.ts utils/playwrightBridgeCoverage.test.ts utils/toolExecutionSupervisor.test.ts utils/toolLoopState.test.ts utils/providerLoops.test.ts`
Expected: PASS

Run: `npm run build`
Expected: build 成功；允许保留现有 duplicated imports / chunk size warnings

- [ ] **Step 2: 更新设计文档**

补充内容：
- runtime 状态机定义
- `blocked / degraded` 的产品语义
- 语义兜底策略：仅明确导航允许自动新开目标 URL
- 跨窗口自动聚焦策略

- [ ] **Step 3: 记录人工回归用例**

至少列出：
- `browser_navigate_back` 命中 closed 错误后不再弹多空白页
- `browser_navigate(url)` 在无目标网页时直接打开目标 URL
- 跨窗口已有网页时自动切换继续
- 非导航类工具在无网页目标时进入 runtime 阻塞态而不是乱建 blank
