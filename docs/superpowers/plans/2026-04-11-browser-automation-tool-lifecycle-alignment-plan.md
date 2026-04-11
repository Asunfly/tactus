# Browser Automation Tool Lifecycle Alignment Plan

> **Status:** 调研结论已确认，暂不在本次提交中继续重构生命周期；先记录方案，后续按此计划收敛。

**Goal:** 将 Tactus 当前 `browser_*` 工具调用生命周期收敛到更接近 `page-agent` 成熟方案的职责边界，避免继续在 provider 层堆积 browser 工具特判。

**Background:** 当前 Tactus 复用了 `@page-agent/page-controller` 执行层，但保留了自己的 provider / sidepanel / tool loop。真实任务压测中暴露出一个核心问题：`browser_exec_js` 等页面操作失败时，Tactus 外层循环会过早把工具结果解释为“整轮工具执行失败”，导致模型拿不到完整 observation 做后续决策。

**Current Temporary State:** 本次提交中的 `toolResultPolicy` 属于止血措施，用于避免 browser 页面失败被直接打断；它不是最终架构，不应继续扩展成更多 browser 工具名级别的特判。

**Tech Stack:** Tactus sidepanel tool loop, `@page-agent/page-controller`, OpenAI-compatible / Anthropic / Gemini provider adapters, Vitest

---

## Research Findings

### 1. `page-agent` 的成熟职责边界

- `PageAgentCore` 的主循环只做四件事：observe、invoke LLM、execute action、把 action 输出写回 history，然后进入下一步。
- `page-agent` agent core 不依赖工具返回的 `success: boolean` 来决定是否继续下一步。
- 真正进入 retry / error 分支的是 LLM 调用失败、无 tool call、tool 参数不合法、schema 校验失败、tool 直接抛错等“协议级失败”。

**Reference Sources:**
- `packages/core/src/PageAgentCore.ts`
- `packages/llms/src/index.ts`
- `packages/llms/src/OpenAIClient.ts`
- `packages/llms/src/errors.ts`

### 2. `page-controller` 与 `page-agent` internal tools 的关系

- `@page-agent/page-controller` 的 DOM 操作方法确实返回 `{ success, message }`。
- 但 `page-agent` internal tools 并不会继续把这个 `success` 上抛给 agent。
- internal tools 统一只把 `result.message` 当作 action output 返回给 `PageAgentCore`，也就是把页面业务失败降级为 observation 文本，而不是 fatal tool error。

**Reference Sources:**
- `packages/core/src/tools/index.ts`
- `node_modules/@page-agent/page-controller/dist/lib/page-controller.js`

### 3. Tactus 当前偏离点

- `entrypoints/sidepanel/App.vue` 中的 `toolExecutor` 把 browser runtime 的 `{ success, result }` 原样返回给上层。
- `utils/api.ts`、`utils/gemini.ts`、`utils/anthropic.ts` 又各自解释一次 `result.success`，导致 provider 层知道了 browser tool 语义。
- 这会让“页面业务失败”和“协议级失败”混在一起，进而把生命周期判断分散到 3 套 provider 实现里。

### 4. 当前临时补丁的局限

- `shouldContinueAfterToolResult(result.name.startsWith('browser_'))` 只能阻止最明显的误中断。
- 它没有真正解决职责分层问题，只是把 browser 工具整体放行。
- 长期看，这会继续模糊两类失败：
  - 可恢复 observation：页面限制、跨域 iframe、脚本执行失败、页面未就绪
  - 应中断或重试的协议失败：参数缺失、action 无效、桥接异常、schema 不合法

---

## Alignment Direction

### Principle A: Browser runtime 负责结果语义归一

- `NativeAutomationRuntime` / bridge 层负责区分：
  - 页面业务失败，应该返回 observation 文本
  - 基础设施或协议失败，应该抛 typed error
- provider 层不再感知 browser tool 的业务级 `success/failure`。

### Principle B: Provider 层只处理协议级错误

- `utils/api.ts`
- `utils/gemini.ts`
- `utils/anthropic.ts`

这些 provider 循环只应该处理：
- tool 参数解析失败
- schema 校验失败
- tool executor 抛错
- provider 网络 / 5xx / timeout

它们不应继续维护 browser 工具名级别的生命周期分支。

### Principle C: Browser tool 输出默认视为 observation

- 对于 `browser_click` / `browser_input` / `browser_select_option` / `browser_scroll` / `browser_exec_js` / `browser_tabs`
- 只要 runtime 能给出可解释文本，就应该优先把它作为 observation 回给模型，而不是在 provider 层升级成 fatal error。

---

## Planned Follow-up Tasks

### Task 1: 统一 browser runtime 结果协议

**Files:**
- Modify: `utils/nativeAutomationRuntime.ts`
- Modify: `utils/nativeAutomationExtension.ts`
- Modify: `entrypoints/sidepanel/App.vue`

- [ ] 明确 browser runtime 的两类输出：observation vs typed error
- [ ] 收敛 `browser_exec_js`、`browser_tabs`、recoverable page receiver 错误的返回形态
- [ ] 避免 sidepanel `toolExecutor` 再把 browser runtime 业务级失败透传成 provider 生命周期信号

### Task 2: 移除 provider 层的 browser 特判

**Files:**
- Modify: `utils/api.ts`
- Modify: `utils/gemini.ts`
- Modify: `utils/anthropic.ts`
- Modify/Delete: `utils/toolResultPolicy.ts`

- [ ] 去掉 provider 层对 browser 工具名空间的特判
- [ ] 保留统一的“协议级失败才进入 retry/error”逻辑
- [ ] 确保 assistant/tool 上下文回滚仍正确

### Task 3: 建立贴近 page-agent 语义的回归测试

**Files:**
- Modify: `utils/nativeAutomationRuntime.test.ts`
- Modify: `utils/toolResultPolicy.test.ts` or replace with new protocol tests
- Add if needed: `utils/nativeAutomationLifecycle.test.ts`

- [ ] 覆盖“页面业务失败返回 observation，模型可继续下一步”
- [ ] 覆盖“协议级失败才进入 retry/error”
- [ ] 覆盖“provider 不再区分 browser_* success/failure”

### Task 4: 实机回放验证

**Files:**
- No required production file changes

- [ ] 使用侧边栏真实插件模式复跑跨标签页任务
- [ ] 只观察链路阻塞点，不人工接管任务执行
- [ ] 确认 `browser_exec_js` 类失败会以 observation 形式被模型吸收，而不是直接显示插件最终报错

---

## Implementation Notes

- 当前提交中的 browser 特判属于临时兼容层，后续重构时应优先删除，而不是继续沿用。
- 当前“元素定位框隐藏时编号也隐藏”的显示层修复与本计划无冲突，应保留。
- 收敛生命周期时，优先复用 `page-agent` 的职责划分，不追求把 `PageAgentCore` 原样接入 Tactus。

## Upstream References

- <https://github.com/alibaba/page-agent/blob/main/packages/core/src/PageAgentCore.ts>
- <https://github.com/alibaba/page-agent/blob/main/packages/core/src/tools/index.ts>
- <https://github.com/alibaba/page-agent/blob/main/packages/llms/src/index.ts>
- <https://github.com/alibaba/page-agent/blob/main/packages/llms/src/OpenAIClient.ts>
- <https://github.com/alibaba/page-agent/blob/main/packages/llms/src/errors.ts>
