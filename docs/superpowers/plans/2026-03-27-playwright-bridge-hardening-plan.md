# Playwright Bridge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性补齐 Tactus 内置 Playwright bridge 的产品级稳定性，避免继续靠“发现一个 bug 补一个 patch”的方式排雷。

**Architecture:** 这次不再把问题拆成零散补丁，而是把整个用户链路当成一个产品闭环来补。sidepanel 负责统一的 Playwright 调用编排、快照纪律和恢复策略；background 负责系统级调试会话生命周期；本地 gateway relay 负责把官方 Playwright 所依赖的 target/session 语义补到足够接近浏览器级 CDP，而不是只做“当前 tab 转发器”。

**Tech Stack:** WXT、Vue 3、TypeScript、Vitest、Node.js、WebSocket、Chrome Debugger API、官方 Playwright MCP / CDP 语义。

---

## Current Failure Matrix

本轮人工联调已经暴露出的错误，需要全部纳入“当前版本稳定性”范围，而不是继续按零碎 patch 处理：

- `Ref ... not found in the current page snapshot`
- `browserContext.newPage: Target page, context or browser has been closed`
- `browserType.connectOverCDP: Target page, context or browser has been closed`
- `Extension disconnected`
- `Cannot access a chrome:// URL`
- `Cannot find context with specified id`
- `Failed to fetch`
- 工具执行成功，但浏览器前台没有切到真实执行的 target tab
- 当前页不可调试时，产品层没有前置阻断 / 自动切换提示

当前稳定性目标：

- 不允许因为单次上下文失效就把整个 gateway / MCP 进程打崩
- 不允许工具实际命中后台 target tab，但用户前台视觉停留在旧 tab
- 不允许只靠“固定重试 3 次”作为主要恢复手段
- 不允许错误恢复逻辑只存在于临时聊天上下文里，必须沉淀为测试和计划

工程边界规则：

- 第一层 transport / 状态机错误，必须由插件、bridge、gateway、executor 代码自己兜住
- 第二层语义/参数错误，后续才交给 agent/LLM 自愈
- 外层聊天编排器不得对 Playwright 工具失败做“原样盲重试”，否则会把两层错误混在一起，既掩盖 transport 故障，也阻断后续 agent 介入

---

## File Structure

**Create**
- `docs/superpowers/plans/2026-03-27-playwright-bridge-hardening-plan.md`
- `utils/playwrightToolExecutor.ts`
- `utils/playwrightToolExecutor.test.ts`
- `packages/tactus-playwright-gateway/README.md`
- `packages/tactus-playwright-gateway/bin/cli.test.mjs` 或等价的 Vitest 适配测试文件

**Modify**
- `entrypoints/sidepanel/App.vue`
- `entrypoints/background.ts`
- `utils/internalPlaywrightBridgeBackground.ts`
- `utils/internalPlaywrightBridgeBackground.test.ts`
- `utils/playwrightToolRecovery.ts`
- `utils/playwrightToolRecovery.test.ts`
- `packages/tactus-playwright-gateway/bin/cli.mjs`
- `README.md`
- `README_ch.md`

**Responsibilities**
- `utils/playwrightToolRecovery.ts`
  Playwright 错误分类、snapshot 预检、stale ref 恢复文案、会话恢复判定。
- `utils/playwrightToolExecutor.ts`
  sidepanel 侧所有 Playwright MCP 调用的唯一入口，统一处理“绑定 tab -> 预检 -> 调用 -> 恢复 -> 日志 -> 返回模型”。
- `utils/internalPlaywrightBridgeBackground.ts`
  调试蓝条生命周期、空闲超时 detach、用户手动关闭调试后的惰性重附着。
- `packages/tactus-playwright-gateway/bin/cli.mjs`
  relay 的浏览器级 target/session 管理，不再停留在单 `connectedTabInfo` 模型。
- `entrypoints/sidepanel/App.vue`
  保留 UI 和现有 automation log，但把 Playwright 细节下沉到 executor，避免继续堆业务逻辑。
- `entrypoints/background.ts`
  提供 bridge 生命周期消息入口和必要的 tab 创建/重绑能力。

---

### Task 1: 固定产品级恢复矩阵

**Files:**
- Modify: `utils/playwrightToolRecovery.ts`
- Modify: `utils/playwrightToolRecovery.test.ts`

- [ ] **Step 1: 补失败测试，锁定完整错误矩阵**

覆盖以下场景：
- stale ref
- `browserContext.newPage`
- `No open pages available`
- `Target page, context or browser has been closed`
- `Extension disconnected`
- `Cannot find context with specified id`
- 系统级调试栏被用户手动关闭

- [ ] **Step 2: 运行测试确认红灯**

Run: `npm test -- utils/playwrightToolRecovery.test.ts`
Expected: FAIL，说明新恢复矩阵尚未实现。

- [ ] **Step 3: 在恢复工具中补全错误分类和恢复策略枚举**

最小实现要求：
- 区分“只需重连”
- 区分“必须先补一个真实 tab 再重连”
- 区分“必须返回新 snapshot 让模型重新决策”
- 区分“网关 / MCP 已崩溃，前端只会收到 Failed to fetch”
- 区分“当前页不可调试，但可以自动切到别的可调试网页”
- 区分“上下文晚到错误只能忽略，不能再继续向 Playwright 扔致命协议错误”

- [ ] **Step 4: 重新运行测试确认通过**

Run: `npm test -- utils/playwrightToolRecovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/playwrightToolRecovery.ts utils/playwrightToolRecovery.test.ts
git commit -m "test: lock playwright recovery matrix"
```

### Task 2: 抽离 sidepanel Playwright 执行编排器

**Files:**
- Create: `utils/playwrightToolExecutor.ts`
- Create: `utils/playwrightToolExecutor.test.ts`
- Modify: `entrypoints/sidepanel/App.vue`

- [ ] **Step 1: 先写失败测试，覆盖统一执行入口**

测试内容：
- 调用前 snapshot 预检
- stale ref 自动返回最新 snapshot
- 会话类错误的自动重绑/重连
- `newPage` 类错误时先创建 tab 再恢复
- 成功调用后附加“只使用最新 snapshot ref”的提示

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/playwrightToolExecutor.test.ts`

- [ ] **Step 3: 实现 `utils/playwrightToolExecutor.ts`**

要求：
- 接收 `mcpManager`、language、当前日志回调、当前 gateway 绑定回调
- 只暴露一个 `executePlaywrightTool(...)`
- 不在里面读写 UI DOM
- 不在 `App.vue` 再散落恢复分支

- [ ] **Step 4: 将 `App.vue` 中 Playwright 执行逻辑替换为 executor 调用**

只保留：
- 风险确认 UI
- automation log 更新
- current session 持久化

- [ ] **Step 5: 跑测试和类型检查**

Run: `npm test -- utils/playwrightToolExecutor.test.ts utils/playwrightToolRecovery.test.ts`
Run: `npm run compile`

- [ ] **Step 6: Commit**

```bash
git add utils/playwrightToolExecutor.ts utils/playwrightToolExecutor.test.ts entrypoints/sidepanel/App.vue
git commit -m "refactor: centralize playwright tool execution"
```

### Task 3: 补齐系统级调试栏生命周期

**Files:**
- Modify: `utils/internalPlaywrightBridgeBackground.ts`
- Modify: `utils/internalPlaywrightBridgeBackground.test.ts`
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: 先写失败测试，覆盖完整生命周期**

测试场景：
- 首次 attach 时蓝条出现
- 空闲超时后 debugger 自动 detach，但 websocket 保持
- 用户手动关闭调试栏后，下条命令自动 re-attach
- 关闭当前 tab 后，bridge 状态清理但不破坏后续恢复
- 同一 websocket 下 rebind 到新 tab 仍能继续工作

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/internalPlaywrightBridgeBackground.test.ts`

- [ ] **Step 3: 实现 background 状态机**

要求：
- `attached` 只是调试会话状态，不等于 socket 生命周期
- idle timer 和 detach 行为解耦
- 手动关闭蓝条只标记为未附着，不直接关闭 relay socket

- [ ] **Step 4: 在 background 中补消息入口**

必要时补充：
- 显式创建/选择 tab 的消息
- 当前绑定状态查询
- 手动 rebind 的轻量 API

- [ ] **Step 5: 重新跑测试**

Run: `npm test -- utils/internalPlaywrightBridgeBackground.test.ts`

- [ ] **Step 6: Commit**

```bash
git add utils/internalPlaywrightBridgeBackground.ts utils/internalPlaywrightBridgeBackground.test.ts entrypoints/background.ts
git commit -m "feat: harden internal debugger session lifecycle"
```

### Task 4: 把 relay 从单 target 升级成浏览器 target 管理器

**Files:**
- Modify: `packages/tactus-playwright-gateway/bin/cli.mjs`
- Create: `packages/tactus-playwright-gateway/bin/cli.test.mjs` 或等价测试文件
- Modify: `packages/tactus-playwright-gateway/README.md`

- [ ] **Step 1: 先写失败测试，锁定官方关键语义**

至少覆盖：
- `Target.setAutoAttach`
- `Target.getTargetInfo`
- `Target.createTarget`
- `Target.attachedToTarget`
- `Target.detachedFromTarget`
- `Target.targetCreated`
- `Target.targetInfoChanged`
- 多个 `targetId/sessionId/tabId` 的映射维护

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- packages/tactus-playwright-gateway/bin/cli.test.mjs`

- [ ] **Step 3: 实现 relay 状态模型**

最小结构：
- `targetsByTargetId`
- `sessionsBySessionId`
- `tabIdByTargetId`
- `primaryPageTargetId`

要求：
- 不再只有一个 `connectedTabInfo`
- `browser_tabs new/select/close` 和 Playwright 原生 page 生命周期不再互相打架

- [ ] **Step 4: 明确 `Target.createTarget` 的产品语义**

产品决定：
- 官方期望创建新 page 时，relay 必须真的创建一个浏览器 tab
- 创建成功后补发完整 attached/created/infoChanged 事件链
- 关闭时也要补 detached 事件

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- packages/tactus-playwright-gateway/bin/cli.test.mjs`

- [ ] **Step 6: Commit**

```bash
git add packages/tactus-playwright-gateway/bin/cli.mjs packages/tactus-playwright-gateway/bin/cli.test.mjs packages/tactus-playwright-gateway/README.md
git commit -m "feat: align internal relay with browser target lifecycle"
```

### Task 4.5: 补齐 gateway / MCP 进程级故障覆盖

**Files:**
- Modify: `packages/tactus-playwright-gateway/bin/cli.mjs`
- Create: `packages/tactus-playwright-gateway/bin/protocolError.mjs`
- Create: `packages/tactus-playwright-gateway/bin/protocolError.test.ts`
- Modify: `packages/tactus-playwright-gateway/bin/cli.test.mjs` 或等价测试文件

- [ ] **Step 1: 锁定会导致前端 `Failed to fetch` 的进程级失败**

至少覆盖：
- relay 把 `Cannot find context with specified id` 直接作为致命协议错误回给 Playwright
- Playwright MCP 子进程退出后，sidepanel 只能收到 transport 级失败
- 当前需要区分“工具失败”和“gateway 进程崩溃”

- [ ] **Step 2: 先写失败测试**

Run: `npm test -- packages/tactus-playwright-gateway/bin/protocolError.test.ts packages/tactus-playwright-gateway/bin/cli.test.mjs`

- [ ] **Step 3: 实现协议错误归一化**

要求：
- 对“上下文晚到失效”的 CDP 错误做降级，不再把它当成 Playwright 致命协议错误
- 保留真正的未知错误和结构化错误
- 明确哪些错误允许忽略，哪些错误必须中断

- [ ] **Step 4: 重新跑测试**

Run: `npm test -- packages/tactus-playwright-gateway/bin/protocolError.test.ts packages/tactus-playwright-gateway/bin/cli.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add packages/tactus-playwright-gateway/bin/cli.mjs packages/tactus-playwright-gateway/bin/protocolError.mjs packages/tactus-playwright-gateway/bin/protocolError.test.ts packages/tactus-playwright-gateway/bin/cli.test.mjs
git commit -m "fix: prevent stale cdp errors from crashing gateway"
```

### Task 5: 收口 sidepanel 的产品层兜底，不再一测一个补丁

**Files:**
- Modify: `entrypoints/sidepanel/App.vue`
- Modify: `utils/playwrightToolExecutor.ts`
- Modify: `utils/automationRisk.ts`（如需要）

- [ ] **Step 1: 补齐统一恢复顺序**

顺序固定为：
1. 确认 gateway server
2. 确认 bound tab / active tab / locked tab
3. snapshot 预检
4. 执行工具
5. 失败时按矩阵恢复
6. 成功时回写“最新 snapshot only”提示
7. 如果真实执行 target tab 发生变化，前台浏览器也必须同步切换过去

- [ ] **Step 2: 去掉散落在 `App.vue` 的临时性分支**

要求：
- 不再继续在 `executePlaywrightMcpTool` 里累积一次性 hack
- `App.vue` 只做 wiring，不再做恢复决策

- [ ] **Step 3: 跑相关测试**

Run: `npm test -- utils/playwrightToolRecovery.test.ts utils/playwrightToolExecutor.test.ts utils/internalPlaywrightBridgeBackground.test.ts`

### Future Phase: Agent Self-Healing Supervisor

> 这一阶段**不属于当前稳定性修复范围**。先把当前版本测稳，再单独实现。

目标：

- 不再只靠“固定重试 3 次”
- 工具失败后，agent 有一层恢复编排，能基于错误类型自动决定下一步动作
- 未知错误才真正停下来交给用户或模型继续判断

预期能力：

- 读取最近一次 Playwright 错误和 automation log
- 判断属于哪一类：stale ref / session 断开 / target 不可调试 / 网关 transport 失败 / 进程已崩溃
- 自动选择恢复动作：
  - 抓新 snapshot
  - 重连 MCP
  - 补 tab
  - 切换到真实 target tab
  - 重启本地 gateway
  - 以新参数重发工具调用
- 记录“恢复前 -> 恢复动作 -> 恢复后”的链路，避免黑盒重试

边界：

- 当前阶段只做“工具层和网关层稳定”
- 不在本阶段引入新的多轮 agent 编排器
- 等当前版本人工验收稳定后，再单独开设计和实现计划
Run: `npm run compile`

- [ ] **Step 4: Commit**

```bash
git add entrypoints/sidepanel/App.vue utils/playwrightToolExecutor.ts utils/automationRisk.ts
git commit -m "refactor: consolidate playwright recovery flow"
```

### Task 6: 一次性验收，不允许再靠“临场补丁”过关

**Files:**
- Modify: `.output/chrome-mv3/*`
- Modify: `README.md`
- Modify: `README_ch.md`

- [ ] **Step 1: 跑完整校验**

Run: `npm test -- utils/playwrightToolRecovery.test.ts utils/playwrightToolExecutor.test.ts utils/internalPlaywrightBridge.test.ts utils/internalPlaywrightBridgeBackground.test.ts utils/playwrightGateway.test.ts utils/automationRisk.test.ts`
Run: `npm run compile`
Run: `npm run build`

- [ ] **Step 2: 逐条完成产品验收矩阵**

必须全部通过：
- 同一页面内多次点击/输入/联想，stale ref 不再直接炸给用户
- 关闭调试蓝条后，下一次 Playwright 工具自动恢复
- 空闲超时后蓝条自动关闭，再次调用自动恢复
- 没有可用页面时，`browser_navigate` / `browser_tabs new` / 需要 page 的操作可自动补页
- 新 tab、选 tab、关 tab 后，后续自动化仍然可继续
- 设置页“测试连接”在一次自动化结束后仍然可用

- [ ] **Step 3: 更新用户文档**

写清楚：
- 本地 gateway 仍需手动启动
- 调试蓝条会按需出现，空闲后自动消失
- 不再需要第二个官方扩展

- [ ] **Step 4: 生成最终构建产物**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add README.md README_ch.md .output/chrome-mv3
git commit -m "feat: harden internal playwright bridge user flow"
```

---

## Acceptance Rule

本计划的完成标准不是“又修掉一个报错”，而是以下两条同时满足：

1. 用户连续跑 Playwright 自动化时，不再频繁撞到同类生命周期 bug。
2. 遇到页面变化、tab 变化、调试栏被关、会话被重置时，产品层能优先自动恢复，而不是把底层错误原样甩回聊天面板。

只要这两条还没满足，就不应该宣称“已对齐官方体验”。
