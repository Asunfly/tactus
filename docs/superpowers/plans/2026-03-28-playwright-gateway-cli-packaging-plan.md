# Playwright Gateway CLI Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前仓库内私有的 `packages/tactus-playwright-gateway` 整理成可通过 `npm` / `npx` 安装运行的本地 CLI，供 Chrome 商店用户复制命令即可安装并启动 Tactus 的本地 Playwright gateway。

**Architecture:** 保持“扩展内置 bridge + 本地 gateway CLI”双端边界不变。扩展继续负责 tab 绑定、debugger 生命周期和 bridge 语义；本地 CLI 继续负责 HTTP MCP、CDP relay 和 `@playwright/mcp` 子进程。首版发布只解决包元数据、入口统一、用户安装指令、发布流程和跨环境验证，不在浏览器扩展内自动拉起本地进程。

**Tech Stack:** Node.js、npm、TypeScript、Vitest、WebSocket、`@playwright/mcp`、WXT 扩展。

**Status:** 延后事项；当前版本先以本地手工验证现有 gateway 链路为主，待验证稳定后再执行本计划。

---

## File Structure

**Create**
- `docs/superpowers/plans/2026-03-28-playwright-gateway-cli-packaging-plan.md`
- `packages/tactus-playwright-gateway/packageMetadata.test.ts`
- `.github/workflows/publish-playwright-gateway.yml`

**Modify**
- `packages/tactus-playwright-gateway/package.json`
- `packages/tactus-playwright-gateway/README.md`
- `packages/tactus-playwright-gateway/bin/cli.mjs`
- `packages/tactus-playwright-gateway/bin/cli.test.ts`
- `packages/tactus-playwright-gateway/bin/npmLauncher.mjs`
- `packages/tactus-playwright-gateway/bin/npmLauncher.test.ts`
- `scripts/local-playwright-gateway.mjs`
- `package.json`
- `README.md`
- `README_ch.md`
- `.github/workflows/pr-check.yml`

**Responsibilities**
- `packages/tactus-playwright-gateway/package.json`
  从仓库内私有辅助包升级为正式可发布的 npm CLI 元数据入口。
- `packages/tactus-playwright-gateway/bin/cli.mjs`
  保持 gateway 主逻辑稳定，对外暴露稳定、可文档化的命令行行为。
- `scripts/local-playwright-gateway.mjs`
  在仓库开发态保留兼容壳层，避免 repo 内测试脚本和正式 npm CLI 出现两套入口漂移。
- `README.md` / `README_ch.md`
  面向扩展用户给出直接可复制的安装和启动命令。
- `.github/workflows/publish-playwright-gateway.yml`
  负责包级 dry-run、发布前检查和正式发布入口。

### Task 1: 固定 npm 包边界与发布元数据

**Files:**
- Create: `packages/tactus-playwright-gateway/packageMetadata.test.ts`
- Modify: `packages/tactus-playwright-gateway/package.json`
- Modify: `packages/tactus-playwright-gateway/README.md`

- [ ] **Step 1: 先写失败测试，锁定正式 npm 包最小元数据**

```ts
import pkg from './package.json';

expect(pkg.private).toBe(false);
expect(pkg.bin['tactus-playwright-gateway']).toBe('./bin/cli.mjs');
expect(pkg.engines.node).toBeDefined();
expect(pkg.files).toContain('bin');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- packages/tactus-playwright-gateway/packageMetadata.test.ts`
Expected: FAIL，因为当前包仍是 `private: true` 且缺少正式发布元数据。

- [ ] **Step 3: 实现最小可发布元数据**

至少补齐：
- 移除 `private: true`
- 正式版本号策略
- `engines.node`
- `repository` / `homepage` / `bugs`
- `keywords`
- 必要时增加 `publishConfig`

- [ ] **Step 4: 用打包结果验证包边界**

Run: `npm pack --json`
Workdir: `packages/tactus-playwright-gateway`
Expected: 只产出一个 tarball，且内容集中在 `bin/**`、`README.md`、`package.json` 等正式发布文件。

- [ ] **Step 5: Commit**

```bash
git add packages/tactus-playwright-gateway/package.json packages/tactus-playwright-gateway/README.md packages/tactus-playwright-gateway/packageMetadata.test.ts
git commit -m "chore: prepare playwright gateway package metadata"
```

### Task 2: 统一正式 CLI 入口与仓库内兼容入口

**Files:**
- Modify: `packages/tactus-playwright-gateway/bin/cli.mjs`
- Modify: `packages/tactus-playwright-gateway/bin/cli.test.ts`
- Modify: `packages/tactus-playwright-gateway/bin/npmLauncher.mjs`
- Modify: `packages/tactus-playwright-gateway/bin/npmLauncher.test.ts`
- Modify: `scripts/local-playwright-gateway.mjs`
- Modify: `package.json`

- [ ] **Step 1: 先补失败测试，锁定 CLI 对外行为**

至少覆盖：
- `--host` / `--port` / `--relay-port` 仍可工作
- `--help` 能输出稳定帮助信息
- Windows 下继续优先走 `node npm-cli.js`
- repo 内 `npm run mcp:playwright` 只是兼容壳层，不再形成第二套逻辑

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- packages/tactus-playwright-gateway/bin/cli.test.ts packages/tactus-playwright-gateway/bin/npmLauncher.test.ts`
Expected: FAIL，说明 CLI 对外契约尚未固定。

- [ ] **Step 3: 收敛到 package-first 入口**

要求：
- `packages/tactus-playwright-gateway/bin/cli.mjs` 成为唯一真实入口
- `scripts/local-playwright-gateway.mjs` 仅保留 `import '../packages/tactus-playwright-gateway/bin/cli.mjs'` 这种 repo 内兼容壳层
- 根 `package.json` 的 `mcp:playwright` 保留为开发者快捷方式，不再作为面向最终用户的主文档入口

- [ ] **Step 4: 重新运行测试**

Run: `npm test -- packages/tactus-playwright-gateway/bin/cli.test.ts packages/tactus-playwright-gateway/bin/npmLauncher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tactus-playwright-gateway/bin/cli.mjs packages/tactus-playwright-gateway/bin/cli.test.ts packages/tactus-playwright-gateway/bin/npmLauncher.mjs packages/tactus-playwright-gateway/bin/npmLauncher.test.ts scripts/local-playwright-gateway.mjs package.json
git commit -m "refactor: make playwright gateway package-first"
```

### Task 3: 整理面向 Chrome 商店用户的安装与启动文档

**Files:**
- Modify: `README.md`
- Modify: `README_ch.md`
- Modify: `packages/tactus-playwright-gateway/README.md`

- [ ] **Step 1: 把用户文档从“仓库脚本”切到“npm CLI”**

至少给出两条正式路径：
- `npx tactus-playwright-gateway --host 127.0.0.1 --port 8931 --relay-port 8932`
- `npm install -g tactus-playwright-gateway` 后运行 `tactus-playwright-gateway --host 127.0.0.1 --port 8931 --relay-port 8932`

- [ ] **Step 2: 保留开发者文档和最终用户文档的分层**

要求：
- 根 README 面向扩展用户，只保留最短安装/启动路径
- package README 面向 CLI 使用者，说明端口、环境变量、故障排查
- `npm run mcp:playwright` 仅作为 repo 开发说明出现，不再成为对外主路径

- [ ] **Step 3: 人工校对 Windows / macOS / Linux 文案**

至少确认：
- Windows PowerShell 命令可直接复制
- macOS / Linux 后台运行示例不依赖仓库目录
- 文案明确说明此 CLI 仍需本地已安装 Node.js / npm

- [ ] **Step 4: Commit**

```bash
git add README.md README_ch.md packages/tactus-playwright-gateway/README.md
git commit -m "docs: publish playwright gateway cli usage"
```

### Task 4: 固定发布流程与回滚入口

**Files:**
- Create: `.github/workflows/publish-playwright-gateway.yml`
- Modify: `.github/workflows/pr-check.yml`
- Modify: `packages/tactus-playwright-gateway/package.json`

- [ ] **Step 1: 先把发布前检查写进 CI**

至少包含：
- `npm test -- packages/tactus-playwright-gateway/packageMetadata.test.ts`
- `npm test -- packages/tactus-playwright-gateway/bin/cli.test.ts packages/tactus-playwright-gateway/bin/npmLauncher.test.ts`
- `npm pack --json` dry-run

- [ ] **Step 2: 增加手动发布工作流**

要求：
- 手动触发或 tag 触发均可，但首版优先手动触发
- 发布前再次执行 dry-run
- 发布失败时保留明确日志，避免半成功状态无人感知

- [ ] **Step 3: 明确版本与回滚规则**

至少约定：
- 发布版本号来源
- 回滚时使用 `npm deprecate` 还是补发修复版
- 何时同步更新扩展文档里的推荐版本

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish-playwright-gateway.yml .github/workflows/pr-check.yml packages/tactus-playwright-gateway/package.json
git commit -m "ci: add playwright gateway publish workflow"
```

### Task 5: 用正式 npm CLI 跑完整验证

**Files:**
- Modify: `scripts/playwright-bridge-smoke.mjs`（仅当脚本里写死 repo 启动路径时）
- Modify: `scripts/playwrightBridgeSmokeRuntime.mjs`（仅当需要抽离启动适配层时）

- [ ] **Step 1: 在干净环境验证 CLI 可独立启动**

至少验证：
- Windows PowerShell
- macOS / Linux shell
- 不依赖仓库根目录

- [ ] **Step 2: 用正式 CLI 重跑现有 smoke E2E**

Run: `node scripts/playwright-bridge-smoke.mjs`
Expected: 现有第一阶段 bridge E2E 继续通过，且 gateway 来源切为正式 CLI 入口。

- [ ] **Step 3: 跑全量基础校验**

Run: `npm run compile`
Run: `npm test`
Expected: PASS

- [ ] **Step 4: 记录残留风险**

至少记录：
- 用户未安装 Node.js / npm 时的失败体验
- `@playwright/mcp` 上游版本漂移风险
- Windows 环境下 npm 启动器差异
- 杀毒/公司策略对本地监听端口的影响

- [ ] **Step 5: Commit**

```bash
git add scripts/playwright-bridge-smoke.mjs scripts/playwrightBridgeSmokeRuntime.mjs
git commit -m "test: validate published playwright gateway cli"
```
