# Agent Self-Healing Supervisor Design

**Goal**

把当前只对 Playwright 有特判恢复、其它工具大量盲重试的执行链路，升级成覆盖内置工具、MCP 工具、Skill 脚本的统一自愈框架。执行结果先经过 runtime 分层恢复，再把结构化 observation 回给模型，由模型在有限预算内决定下一步动作。

## Current Problems

- OpenAI / Anthropic / Gemini 三条 tool loop 都有“工具失败后剔除本轮 assistant/tool 上下文并直接重试”的路径。
- 只有 Playwright MCP browser 工具被排除出盲重试，并走了单独的 `playwrightToolExecutor` 恢复逻辑。
- Skill 脚本和普通 MCP 工具失败后，模型拿不到足够结构化的 observation，只能依赖前端框架自行决定是否重试。
- 风险确认只对一部分浏览器自动化操作生效，没有形成“自愈回合中的副作用二次确认”规则。

## Design Principles

- 第一层 deterministic 恢复留在 runtime：协议、连接、transport、session、target、gateway 进程等问题先由代码兜底。
- 第二层 observation 回给模型：参数不合适、目标不匹配、上下文过期、脚本输入不正确等问题交给模型判断。
- 所有工具共享同一份自愈预算：每次用户请求最多允许 3 次模型可见的自愈回合。
- 危险操作与副作用原始操作在自愈阶段必须二次确认。
- 不新建独立 planner agent；第一版仍然基于现有单轮 ReAct/tool loop 演进。

## Target Architecture

### 1. Unified Tool Loop

保留现有三条 provider-specific 流式实现，但它们都改成依赖统一的 tool outcome 协议：

1. 模型产出 tool call
2. 前端统一 executor 执行工具
3. executor 返回结构化 `ToolResult`
4. tool loop 根据 `ToolResult.meta` 决定：
   - 继续正常下一轮
   - 计入 1 次 self-heal 回合并把 observation 喂回模型
   - 禁止后续继续调工具，只允许模型向用户解释并请求帮助

### 2. Unified Executor

新增 `utils/toolExecutionSupervisor.ts`，负责：

- 统一路由内置工具、MCP 工具、Skill 脚本
- 做工具级 deterministic 恢复
- 做统一风险评估与二次确认
- 产出结构化 observation
- 统一写 automation log

### 3. Tool Adapters

- Playwright adapter：复用 `playwrightToolExecutor.ts`，保留现有 snapshot / rebind / reconnect 等恢复。
- Generic MCP adapter：处理 server 未连接、transport 失败、必要时自动 reconnect，再回给模型。
- Built-in adapter：`extract_page_content`、`activate_skill`、`read_skill_file` 等。
- Skill script adapter：包装 `executeScript`，把信任确认、执行失败、脚本异常统一纳入 tool outcome。

## Core Protocol

扩展现有 `ToolResult`，新增 `meta` 字段：

```ts
interface ToolResultMeta {
  outcome: 'success' | 'recoverable_error' | 'fatal_error';
  recoveryLayer: 'runtime' | 'model' | 'user';
  failureKind?:
    | 'tool_args'
    | 'tool_runtime'
    | 'transport'
    | 'permission'
    | 'user_cancelled'
    | 'budget_exhausted'
    | 'unknown';
  consumesSelfHealRound?: boolean;
  disableFurtherToolCalls?: boolean;
  requiresRetryConfirmation?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
}
```

约束：

- `success`：正常 tool result，继续下一轮。
- `recoverable_error`：把结果作为 `role: tool` observation 回给模型，并消耗 1 次 self-heal 回合。
- `fatal_error`：tool result 仍然回给模型，但下一轮禁用工具，让模型只做解释/求助。

## Observation Format

所有失败 observation 统一成结构化文本，避免不同工具各自拼一套杂乱字符串：

```text
Tool execution outcome
- Tool: <name>
- Status: recoverable_error
- Recovery layer: model
- Failure kind: tool_runtime
- Self-heal round: 1/3
- Summary: <short summary>
- Recommended next actions:
  - inspect latest observation
  - adjust arguments
  - choose a different tool
  - ask user for confirmation if the next action has side effects

Details:
<raw error or recovery note>
```

Playwright 仍可继续返回最新 snapshot，但也要落在这一结构下，避免特殊协议漂在外面。

## Self-Heal Budget

每次请求维护一份 `ToolLoopState`：

```ts
interface ToolLoopState {
  maxSelfHealRounds: number; // first version: 3
  usedSelfHealRounds: number;
  toolUseDisabled: boolean;
}
```

规则：

- 失败 observation 若 `consumesSelfHealRound=true`，则 `usedSelfHealRounds += 1`
- 未超预算：继续让模型决策
- 超预算：把本次结果改写为 `budget_exhausted`，并禁用后续工具
- 禁用工具后继续跑 1 次模型回复，让模型用自然语言解释当前失败并向用户请求下一步指令

## Confirmation Policy

### First execution

- 保留现有危险操作确认逻辑
- Skill 脚本保留 trust confirm 逻辑

### Retry during self-heal

如果满足以下任一条件，重新执行前必须再次确认：

- `riskLevel === 'high'`
- 属于副作用原始操作（`medium` 以上）
- `execute_skill_script`

允许自动执行的只读/辅助动作：

- 抓快照
- 读取页面/文件
- 列 tab / 读 console / 读 network
- reconnect MCP
- restart local gateway
- rebind target / switch to another recoverable web tab / open explicit navigation target URL as recovery helper

## Logging

继续复用现有 `automationLog` 存储，不单独新增第二套 log schema。

记录范围从“Playwright automation”扩大到“all tool execution recovery”，每条记录至少包含：

- tool name
- server/source
- summary
- risk level
- status
- detail

关键 detail 需要包含：

- 原始失败摘要
- runtime 已尝试的恢复动作
- 当前 self-heal round
- 是否等待二次确认

## Provider Loop Changes

三条 provider loop 需要统一变化：

1. 去掉“失败后直接剔除 assistant/tool 消息再盲重试”的逻辑
2. 参数解析失败不再盲重试，改成 synthetic tool result 回给模型
3. 支持 `maxSelfHealRounds`
4. 支持在 budget exhausted 后禁用工具，再跑一轮纯文本答复

## Scope For First Version

### Included

- 内置工具
- MCP 工具
- Skill 脚本
- Playwright 现有恢复逻辑接入统一协议
- 2-3 次自愈回合（first version 固定为 3）
- 危险/副作用操作自愈时二次确认

### Excluded

- 多 agent supervisor / planner-executor 架构
- 持久化跨轮长期失败记忆
- 自动学习用户偏好后的免确认策略
- 新增设置页开关；第一版先用固定策略

## Risks

- 三条 provider loop 同时改动，容易引入行为分叉。
- `automationLog` 现有文案偏向浏览器自动化，第一版只能先复用，UI 命名暂不完美。
- Skill 脚本的“是否有副作用”无法静态可靠判断，第一版按保守策略处理：自愈重跑时统一二次确认。

## Recommended Rollout

1. 先抽统一 `ToolResult.meta` 和 loop state helper
2. 再接入 App.vue 的统一 supervisor
3. 最后把三个 provider loop 切到新协议
4. 先跑单测，再跑本机 smoke，最后人工回归自愈场景
