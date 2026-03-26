# Playwright Page Automation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Tactus 中落地一版可实际跑通的 Playwright 当前页自动化链路，包含本地 gateway 接入、风险确认和执行日志。

**Architecture:** 复用官方 `@playwright/mcp` 作为本地 HTTP MCP 服务内核，Tactus 继续走现有 HTTP MCP 客户端。新增一层前端侧风险分级和日志展示，保证右侧侧边栏输入与左侧当前页面执行的体验一致。

**Tech Stack:** WXT、Vue 3、TypeScript、Vitest、官方 Playwright MCP。

---

### Task 1: 纯逻辑能力抽离

**Files:**
- Create: `utils/automationRisk.ts`
- Create: `utils/playwrightGateway.ts`
- Test: `utils/automationRisk.test.ts`
- Test: `utils/playwrightGateway.test.ts`

- [ ] **Step 1: 写失败测试，覆盖风险分级和 gateway 默认配置**
- [ ] **Step 2: 运行对应测试，确认失败原因正确**
- [ ] **Step 3: 实现最小逻辑直到测试通过**
- [ ] **Step 4: 运行单测确认通过**

### Task 2: 设置页接入 Playwright gateway

**Files:**
- Modify: `entrypoints/options/App.vue`
- Modify: `entrypoints/options/style.css`
- Modify: `utils/i18n.ts`

- [ ] **Step 1: 先补 UI 文案和本地 gateway 配置辅助逻辑**
- [ ] **Step 2: 接入 MCP 配置页的一键添加与引导卡片**
- [ ] **Step 3: 运行类型检查验证界面接线**

### Task 3: 侧边栏风险确认与执行日志

**Files:**
- Modify: `entrypoints/sidepanel/App.vue`
- Modify: `entrypoints/sidepanel/style.css`
- Modify: `utils/db.ts`

- [ ] **Step 1: 先接入运行态日志结构和会话持久化**
- [ ] **Step 2: 在 MCP 工具执行前增加 Playwright 风险分级与确认**
- [ ] **Step 3: 把执行日志展示到侧边栏 UI**
- [ ] **Step 4: 跑类型检查与现有测试**

### Task 4: 本地 gateway 启动脚本与文档

**Files:**
- Create: `scripts/local-playwright-gateway.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `README_ch.md`

- [ ] **Step 1: 增加本地 gateway 启动脚本和 npm script**
- [ ] **Step 2: 写清楚 Bridge 扩展、启动命令和接入步骤**
- [ ] **Step 3: 运行最终验证**
