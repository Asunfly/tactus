# Agent Self-Healing Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为内置工具、MCP 工具和 Skill 脚本建立统一的自愈执行协议，让模型在 3 次预算内看到失败 observation 并决定下一步。

**Architecture:** 保留现有 provider-specific 流式实现，但让它们共享同一份 tool result meta、self-heal budget 和 tool disabling 规则。工具侧通过统一 supervisor 做 deterministic 恢复、风险确认和 observation 生成，provider loop 只负责根据 meta 决定是否继续给模型。

**Tech Stack:** WXT、Vue 3、TypeScript、Vitest、OpenAI / Anthropic / Gemini tool loop、MCP、Skill script executor。

---

## File Structure

**Create**
- `docs/superpowers/specs/2026-03-28-agent-self-healing-supervisor-design.md`
- `docs/superpowers/plans/2026-03-28-agent-self-healing-supervisor-plan.md`
- `utils/toolExecutionSupervisor.ts`
- `utils/toolExecutionSupervisor.test.ts`
- `utils/toolLoopState.ts`
- `utils/toolLoopState.test.ts`

**Modify**
- `utils/tools.ts`
- `utils/automationRisk.ts`
- `utils/api.ts`
- `utils/anthropic.ts`
- `utils/gemini.ts`
- `entrypoints/sidepanel/App.vue`
- `utils/playwrightToolExecutor.ts`（如需补 meta）
- `utils/skillsExecutor.ts`（如需补错误分类/风险语义）
- `utils/db.ts`（仅在 log 结构必须补字段时）

**Responsibilities**
- `utils/toolExecutionSupervisor.ts`
  统一封装工具执行、runtime 恢复、风险确认、observation 构造、log 写入。
- `utils/toolLoopState.ts`
  维护 self-heal budget、budget exhausted 后禁用工具、provider loop 公共决策。
- `utils/tools.ts`
  扩展 `ToolResult` / `ToolExecutor` 类型，承载 `meta` 和 self-heal 执行上下文。
- `utils/automationRisk.ts`
  从 Playwright 扩展到全工具风险评估，支持“自愈重跑二次确认”。

### Task 1: 固定统一 Tool Result 协议

**Files:**
- Create: `utils/toolLoopState.ts`
- Create: `utils/toolLoopState.test.ts`
- Modify: `utils/tools.ts`

- [ ] **Step 1: 先写失败测试，锁定 self-heal 状态机**

覆盖以下场景：
- recoverable error 消耗 1 次预算
- 超过预算后禁止继续调工具
- fatal error 直接切到“只允许模型解释”
- success 不消耗预算

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/toolLoopState.test.ts`

- [ ] **Step 3: 扩展 `ToolResult` 与 `ToolExecutor` 类型**

至少补齐：
- `ToolResult.meta`
- `ToolExecutionContext`
- `ToolLoopState`

- [ ] **Step 4: 实现 `utils/toolLoopState.ts` 最小状态机**

- [ ] **Step 5: 重新运行测试确认通过**

Run: `npm test -- utils/toolLoopState.test.ts`

### Task 2: 实现统一工具执行 supervisor

**Files:**
- Create: `utils/toolExecutionSupervisor.ts`
- Create: `utils/toolExecutionSupervisor.test.ts`
- Modify: `utils/automationRisk.ts`

- [ ] **Step 1: 先写失败测试，锁定全工具 observation 与确认策略**

至少覆盖：
- 普通 MCP 失败被包装成 recoverable observation
- `execute_skill_script` 在自愈重跑时要求二次确认
- 只读工具在自愈回合可自动执行
- fatal error 会设置 `disableFurtherToolCalls`

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/toolExecutionSupervisor.test.ts`

- [ ] **Step 3: 扩展风险评估到全工具**

要求：
- 浏览器自动化保留现有策略
- `execute_skill_script` 视为高风险
- 普通读取类工具默认为低风险
- 自愈回合中的 `medium/high` 操作要求再次确认

- [ ] **Step 4: 实现 `utils/toolExecutionSupervisor.ts`**

要求：
- 接受 raw executor / language / log callbacks / confirmation callback
- 构造统一 observation 文本
- 对普通 MCP transport 错误预留 runtime reconnect
- 不把 provider-specific 逻辑写死在 supervisor 里

- [ ] **Step 5: 重新运行测试确认通过**

Run: `npm test -- utils/toolExecutionSupervisor.test.ts utils/toolLoopState.test.ts`

### Task 3: 接入 sidepanel 统一执行入口

**Files:**
- Modify: `entrypoints/sidepanel/App.vue`
- Modify: `utils/skillsExecutor.ts`
- Modify: `utils/playwrightToolExecutor.ts`

- [ ] **Step 1: 先写/补失败测试，锁定 App.vue 执行分发语义**

覆盖：
- 内置工具、MCP 工具、Skill 脚本都走统一 supervisor
- Playwright adapter 继续复用现有 deterministic recovery
- Skill script 失败能被包装为 observation

- [ ] **Step 2: 运行相关测试确认失败**

Run: `npm test -- utils/toolExecutionSupervisor.test.ts utils/playwrightToolExecutor.test.ts`

- [ ] **Step 3: 把 `App.vue` 里的 raw tool 分发与 supervisor 组装分层**

要求：
- `App.vue` 只保留 wiring
- raw executor 与 supervisor 组装逻辑分开
- automation log 对所有工具都可复用

- [ ] **Step 4: 必要时给 Playwright / Skill script 结果补 `meta`**

- [ ] **Step 5: 跑相关测试**

Run: `npm test -- utils/toolExecutionSupervisor.test.ts utils/playwrightToolExecutor.test.ts utils/toolLoopState.test.ts`

### Task 4: 改造三条 provider loop

**Files:**
- Modify: `utils/api.ts`
- Modify: `utils/anthropic.ts`
- Modify: `utils/gemini.ts`

- [ ] **Step 1: 先写失败测试，锁定 loop 不再盲重试**

至少覆盖：
- 参数解析错误改成 synthetic tool result
- 失败 tool result 保留在上下文里
- recoverable error 消耗 self-heal budget
- budget exhausted 后禁用工具并让模型输出最终解释

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/toolLoopState.test.ts utils/toolExecutionSupervisor.test.ts`

- [ ] **Step 3: 在 OpenAI loop 中接入 state helper**

- [ ] **Step 4: 在 Anthropic loop 中接入相同语义**

- [ ] **Step 5: 在 Gemini loop 中接入相同语义**

- [ ] **Step 6: 删除或收口 blind retry 逻辑**

要求：
- `shouldBlindRetryToolExecutionFailure` 不再作为主恢复机制
- parse error 不再剔除整轮 assistant/tool 上下文

- [ ] **Step 7: 跑全量测试和 compile**

Run: `npm test`
Run: `npm run compile`

### Task 5: 本机 smoke 与人工验收

**Files:**
- Modify: `scripts/playwright-bridge-smoke.mjs`（仅如需补 log 观察）

- [ ] **Step 1: 跑本机 smoke E2E**

Run: `node scripts/playwright-bridge-smoke.mjs`

- [ ] **Step 2: 做最小人工回归**

至少验证：
- 普通 MCP 工具失败后，模型能看到 observation 而不是框架直接吞掉
- Skill script 失败后，模型能收到结构化结果
- 自愈回合中再次执行副作用操作会弹确认
- 超过 3 次自愈预算后，模型不再继续调工具，而是向用户解释失败

- [ ] **Step 3: 记录残留风险与后续阶段**

### Task 6: Commit

**Files:**
- Modify: 本计划涉及的所有代码与文档

- [ ] **Step 1: 提交实现**

```bash
git add docs/superpowers/specs/2026-03-28-agent-self-healing-supervisor-design.md docs/superpowers/plans/2026-03-28-agent-self-healing-supervisor-plan.md utils/tools.ts utils/automationRisk.ts utils/toolExecutionSupervisor.ts utils/toolExecutionSupervisor.test.ts utils/toolLoopState.ts utils/toolLoopState.test.ts utils/api.ts utils/anthropic.ts utils/gemini.ts entrypoints/sidepanel/App.vue utils/playwrightToolExecutor.ts utils/skillsExecutor.ts
git commit -m "feat: add unified agent self-healing tool loop"
```
