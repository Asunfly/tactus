# 2026-04-03 Playwright Runtime 问题排查记录

## 范围

本记录整理本轮使用内置 Playwright Gateway 时观察到的两类问题，作为后续集中修补前的排查依据：

1. 自动化工具偶发卡住 15-30 秒，随后以 `recoverable_error` 或超时形式返回。
2. 使用过程中会弹出一些没有必要的空白标签页（`about:blank`）。

本文件只记录现象、证据、阶段性结论和后续修补方向，不包含本轮实现变更。

## 问题一：Playwright 工具调用卡住

### 现象

- 在 `browser_navigate`、`browser_run_code` 等工具调用中，偶发出现“卡很久后才失败”。
- 在高风险确认框停留较久后，更容易出现后续工具调用卡住。
- 已知出现过的工具层表现：
  - `recoverable_error`
  - `TimeoutError`
  - 推荐动作误导性地提示 “the element may be obscured...”

### 已确认的证据

#### 1. MCP HTTP 层仍然可用

- 本地 `http://localhost:8931/mcp` 可立即建立连接。
- 普通 `GET /mcp` 返回 `400 Invalid request`，说明 HTTP 服务仍在线。

#### 2. 网关进程与 MCP 子进程未退出

- `npm run mcp:playwright`
- `node ./scripts/local-playwright-gateway.mjs`
- `playwright-mcp`

上述进程在问题出现时仍然处于存活状态。

#### 3. 只读探针可以复现“连得上，但工具卡住”

使用本地 MCP 探针调用 `browser_snapshot` 时：

- `client.connect(...)` 立即成功。
- `browser_snapshot` 在 15 秒内无返回。
- 延长等待到 30 秒后，返回的错误文本为：

```text
TimeoutError: Timeout 30000ms exceeded.
Call log:
  - <ws connecting> ws://127.0.0.1:8932/cdp
  - <ws connected> ws://127.0.0.1:8932/cdp
```

这说明：

- `/mcp` 没有卡住。
- `/cdp` 连接也建立了。
- 真正卡住的是 relay 后面的浏览器桥接阶段。

#### 4. 卡住时 `8932` 只有监听，没有活跃桥接连接

在超时现场查看端口状态：

- `8931` 仍有 ESTABLISHED 连接。
- `8932` 只有 LISTEN，没有任何 ESTABLISHED 连接。

这意味着 relay 监听仍在，但扩展侧 `/extension` websocket 没有连着。

### 代码层证据

- `Target.setAutoAttach` 和后续普通 CDP 转发都依赖扩展 websocket 在线：
  - [packages/tactus-playwright-gateway/bin/relayRuntime.mjs](../../../packages/tactus-playwright-gateway/bin/relayRuntime.mjs)
  - 关键位置：
    - `waitForExtensionConnection()` 后再 `attachToTab`：57-63
    - `waitForExtensionConnection()` 后再 `forwardCDPCommand`：136-142
- 网关内部等待扩展连接的超时是 30 秒：
  - [packages/tactus-playwright-gateway/bin/cli.mjs](../../../packages/tactus-playwright-gateway/bin/cli.mjs) 269-277
- sidepanel/runtime 当前是否重绑只看 `boundTabId` 和 MCP connected 状态：
  - [utils/playwrightRuntimeController.ts](../../../utils/playwrightRuntimeController.ts) 386-395
- 高风险确认弹窗本身没有超时，会无限等待用户点击：
  - [entrypoints/sidepanel/App.vue](../../../entrypoints/sidepanel/App.vue) 1098-1102

### 阶段性结论

当前更接近下面这条链路：

1. sidepanel 仍认为 runtime “健康”，因为 `boundTabId` 还在、MCP client 也还连着。
2. 实际上扩展 background / service worker 对 relay 的 `/extension` websocket 已经断开。
3. 新工具请求进入 `playwright-mcp` 后，`/cdp` 可以正常连上 relay。
4. 但 relay 在真正转发 `attachToTab` 或 `forwardCDPCommand` 前，会等待扩展 websocket 回连。
5. 扩展没有及时回连，于是请求在 30 秒超时后才失败。

换句话说，问题不是“本地 gateway 挂了”，而是“runtime 健康状态失真，导致该重绑时没有重绑”。

### 为什么高风险确认更容易触发

高风险确认会在真正执行工具前停住流程，而这段等待没有超时保护：

- 对 `browser_run_code`，风险评估固定要求确认：
  - [utils/automationRisk.ts](../../../utils/automationRisk.ts) 186-195
- 确认期间如果时间较长，扩展 bridge 更容易在空闲状态下失活。
- 当前空闲断开逻辑默认 120 秒后 detach debugger：
  - [utils/internalPlaywrightBridgeBackground.ts](../../../utils/internalPlaywrightBridgeBackground.ts) 131
  - [utils/internalPlaywrightBridgeBackground.ts](../../../utils/internalPlaywrightBridgeBackground.ts) 478-500

需要注意：

- “仅 debugger idle detach” 不是唯一问题；按现有测试，这条路径理论上可在下一条命令时自动重新 attach。
- 更像是 “debugger 空闲 + background / websocket 生命周期失活 + sidepanel 未强制重绑” 叠加后造成的卡死。

### 误导性提示

当前工具监督层会把超时类错误统一映射成“元素可能被遮挡/未加载完成”的建议：

- [utils/toolExecutionSupervisor.ts](../../../utils/toolExecutionSupervisor.ts) 212-217

这对 `browser_run_code`、`browser_snapshot` 这种场景并不准确，会掩盖真正的 bridge 断连问题。

## 问题二：使用中会弹出不必要的空白标签页

### 现象

- 使用过程中会出现一些用户并未主动期待的 `about:blank` 标签页。
- 这类空白页不一定来自同一条代码路径，当前至少发现了几条明确会产生 blank tab 的入口。

### 已确认的 blank tab 入口

#### 1. `browser_tabs.action = new` 是显式创建空白页

- `browser_tabs` 的 `new` 动作直接调用 `createBlankTab()`：
  - [entrypoints/sidepanel/App.vue](../../../entrypoints/sidepanel/App.vue) 467-469
- `createBlankTab()` 会显式创建 `about:blank`：
  - [utils/playwrightRuntimeController.ts](../../../utils/playwrightRuntimeController.ts) 171-180

这条路径是“有意设计”的，不属于 bug。

#### 2. Playwright 原生 `Target.createTarget` 也会真实创建新 tab

- relay 对 `Target.createTarget` 的实现会调用扩展侧 `createTab(...)`。
- 如果没有给 URL，默认就是 `about:blank`：
  - [packages/tactus-playwright-gateway/bin/relayRuntime.mjs](../../../packages/tactus-playwright-gateway/bin/relayRuntime.mjs) 77-82
- 历史计划里已明确这条产品语义：
  - 官方期望创建新 page 时，relay 必须真的创建一个浏览器 tab。
  - 见 [docs/superpowers/plans/2026-03-27-playwright-bridge-hardening-plan.md](./2026-03-27-playwright-bridge-hardening-plan.md) 243-249

这条路径本身也不一定是 bug，但如果 Playwright 会在恢复或 bootstrap 阶段频繁触发 `Target.createTarget`，就会表现成“使用中莫名其妙弹 blank tab”。

### 可疑的状态机不一致

#### 1. `about:blank` 被同时当作“不可调试网页”和“显式绑定后的可继续目标”

- 正常网页判定明确排除了 `about:blank`：
  - [utils/internalPlaywrightBridge.ts](../../../utils/internalPlaywrightBridge.ts) 68-74
- 但对已绑定/已锁定目标，`about:blank` 又被视为 `preferred`：
  - [utils/internalPlaywrightBridge.ts](../../../utils/internalPlaywrightBridge.ts) 77-79
  - [utils/internalPlaywrightBridge.ts](../../../utils/internalPlaywrightBridge.ts) 100-112
- 现有测试还明确固化了这个行为：
  - [utils/internalPlaywrightBridge.test.ts](../../../utils/internalPlaywrightBridge.test.ts) 138-166

这会导致一种不一致：

- 活动页是 `about:blank` 时，系统会回退到真正网页。
- 但如果 `about:blank` 已经被绑定过，它又会继续被当成当前目标。

这和设计文档中“非导航类动作在没有真实网页目标时进入 blocked，而不是隐式创建 `about:blank`”存在张力：

- [docs/superpowers/specs/2026-03-26-internal-playwright-bridge-design.md](../specs/2026-03-26-internal-playwright-bridge-design.md) 89-92
- [docs/superpowers/plans/2026-03-30-playwright-runtime-state-machine-plan.md](./2026-03-30-playwright-runtime-state-machine-plan.md) 135-139

#### 2. `blankTarget` 仍被 runtime 明确保留

- `resolveEnvironment()` 里会把 `about:blank` 收集为 `blankTarget`：
  - [utils/playwrightRuntimeController.ts](../../../utils/playwrightRuntimeController.ts) 474-482

当前这一字段在本轮代码里没有直接触发自动创建 blank tab，但它说明状态机仍在保留 blank 页面作为一种特殊恢复候选，后续修补时应一起梳理。

### 当前更可信的阶段性结论

“空白 tab”大概率不是单一原因，而是至少包含两类来源：

1. 合法但产品体验上容易让人误会的来源
   - `browser_tabs new`
   - Playwright 原生 `Target.createTarget`

2. 状态机/恢复逻辑带来的异常放大
   - 已绑定的 `about:blank` 会继续被当成 ready target
   - 这可能让后续恢复、重绑或工具调用围绕 blank tab 打转

换句话说：

- “会弹 blank tab” 可能有一部分是产品语义本来就允许。
- “会弹不必要的 blank tab” 更像是状态机没有把 blank tab 和真实业务网页目标彻底分开。

### 目前还缺的证据

本轮还没有抓到“用户看到 blank tab 的那次调用”对应的具体工具链，因此还不能精确断言以下哪条是主因：

- 模型主动调用了 `browser_tabs.new`
- `playwright-mcp` 在内部 session/bootstrap/recovery 中触发了 `Target.createTarget`
- runtime 由于绑定态失真，把已有 `about:blank` 错当成了可继续执行的目标

后续修补前，建议增加最小日志，把以下事件打出来：

- `browser_tabs.new`
- `createBlankTab()`
- relay `Target.createTarget`
- background `createTab`
- runtime 选择目标时命中了哪个 `source`

## 后续修补方向

### 对卡住问题

优先级最高的方向：

1. 对内置 Playwright gateway 增加 bridge health-check 或无条件 rebind。
2. 不再仅依赖 `boundTabId` + MCP connected 判断 runtime 是否健康。
3. 确认框后恢复执行前，增加一次显式 bridge 唤醒/重绑。
4. 超时提示文案细分，避免把 bridge 断连误提示成“元素被遮挡”。

### 对 blank tab 问题

建议后续一并处理：

1. 明确区分“用户显式要新开页”和“runtime/Playwright 内部恢复动作”。
2. 重新审视 `about:blank` 在 bound/locked 场景下是否应该继续被视为 ready target。
3. 审核 `Target.createTarget` 在当前产品语义下的触发频率与必要性。
4. 增加日志，把 blank tab 的真实来源记录下来，再决定是否收紧产品语义。

## 当前结论摘要

- 卡住问题的主因已基本收敛：不是 gateway 死掉，而是扩展 bridge 断开后，runtime 没有及时重绑。
- 空白 tab 问题暂时判断为“多来源叠加”，其中既有设计允许的 blank tab，也有状态机处理不够收敛的嫌疑。
- 两个问题高度相关：一旦 runtime 状态失真，blank tab 更容易被错误保留、错误重绑，进一步放大恢复异常。
