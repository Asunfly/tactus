# Internal Playwright Bridge MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Tactus 在不依赖外部 Playwright Bridge 扩展的前提下，尽量对齐官方 Bridge 语义，既支持当前页，也支持新 tab / 新 target。

**Architecture:** 本地 gateway 进程新增一个固定端口 WebSocket relay，官方 `@playwright/mcp` 继续负责 HTTP MCP 与 Playwright 工具实现，但改走 `--cdp-endpoint`。Tactus background 内置 bridge 不再只绑定单 tab，而是维护默认 tab、target/session、以及新 tab 生命周期，尽量复现官方 Bridge 行为。

**Tech Stack:** WXT、Vue 3、TypeScript、Vitest、Node.js、WebSocket、官方 Playwright MCP/CDP relay 设计。

---

### Task 1: 抽离内置 bridge 纯逻辑与失败测试

**Files:**
- Create: `utils/internalPlaywrightBridge.ts`
- Create: `utils/internalPlaywrightBridge.test.ts`

- [ ] **Step 1: 写失败测试**
覆盖 relay 端口、端点地址、当前页绑定消息、server 配置辅助逻辑。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/internalPlaywrightBridge.test.ts`

- [ ] **Step 3: 写最小实现**

- [ ] **Step 4: 再跑测试确认通过**

Run: `npm test -- utils/internalPlaywrightBridge.test.ts`

### Task 2: 本地 relay/gateway MVP

**Files:**
- Modify: `scripts/local-playwright-gateway.mjs`
- Modify: `package.json`
- Modify: `utils/playwrightGateway.ts`
- Test: `utils/playwrightGateway.test.ts`

- [ ] **Step 1: 先补失败测试**
让测试明确要求 gateway 走 `--cdp-endpoint`，并暴露固定 relay 端口。

- [ ] **Step 2: 跑测试确认红灯**

Run: `npm test -- utils/playwrightGateway.test.ts`

- [ ] **Step 3: 实现最小 relay 启动和 MCP 子进程拼装**

- [ ] **Step 4: 重新运行测试**

Run: `npm test -- utils/playwrightGateway.test.ts`

### Task 3: Tactus background 内置 bridge 语义版

**Files:**
- Create: `utils/internalPlaywrightBridgeBackground.ts`
- Create: `utils/internalPlaywrightBridgeBackground.test.ts`
- Modify: `entrypoints/background.ts`
- Modify: `wxt.config.ts`

- [ ] **Step 1: 写失败测试**
覆盖 bridge 连接状态、attachToTab、forwardCDPCommand、默认 tab 绑定、新 target / 新 tab 生命周期。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- utils/internalPlaywrightBridgeBackground.test.ts`

- [ ] **Step 3: 实现支持多 target 的 background bridge 管理器**

- [ ] **Step 4: 接入 background message 和 manifest 权限**

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- utils/internalPlaywrightBridgeBackground.test.ts`

### Task 4: sidepanel 与设置页切换到内置 bridge 语义

**Files:**
- Modify: `entrypoints/sidepanel/App.vue`
- Modify: `entrypoints/options/App.vue`
- Modify: `utils/i18n.ts`
- Modify: `README.md`
- Modify: `README_ch.md`

- [ ] **Step 1: 在 sidepanel builtin gateway 建连前准备默认 tab 绑定，但不再把语义收窄成“仅当前页”**
- [ ] **Step 2: 把设置页文案从“官方 Bridge 扩展”改成“内置 bridge + 本地 gateway”**
- [ ] **Step 3: 更新双语 README**
- [ ] **Step 4: 运行类型检查与相关测试**

Run: `npm run compile`
Run: `npm test -- utils/internalPlaywrightBridge.test.ts utils/internalPlaywrightBridgeBackground.test.ts utils/playwrightGateway.test.ts utils/automationRisk.test.ts`

### Task 5: 最终验证

**Files:**
- Modify: `.output/chrome-mv3/*`（构建产物）

- [ ] **Step 1: 运行正式构建**

Run: `npm run build`

- [ ] **Step 2: 记录残留 warning 与风险**

- [ ] **Step 3: 准备手工验证说明**
