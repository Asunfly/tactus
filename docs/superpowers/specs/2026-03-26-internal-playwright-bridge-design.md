# 内置 Playwright Bridge MVP 设计说明

**目标**

在保留本地 Playwright MCP HTTP 接口能力的前提下，去掉对外部 `Playwright MCP Bridge` 浏览器扩展和 `connect.html` 选页流程的依赖，让 Tactus 自己接管官方 Bridge 语义：

- 有当前页时优先绑定当前页
- 需要新页面时允许创建新 tab / 新 target
- 支持后续跨 tab 与多 target 的持续转发

## 设计结论

MVP 采用“本地 relay + Tactus 内置 bridge”的双端方案：

- 本地 Node 进程继续提供 HTTP MCP 服务，保持现有接入方式不变
- 本地进程内部新增一个固定端口的 WebSocket relay，兼容 Playwright `connectOverCDP`
- Tactus background 内置官方 Bridge 语义版 bridge，维护“relay 连接 -> target/session -> tab”映射
- 不再使用官方 `@playwright/mcp --extension`
- 改为 `@playwright/mcp --cdp-endpoint ws://127.0.0.1:<relayPort>/cdp`

## 为什么不继续沿用官方 Bridge 扩展

- 官方 Bridge 扩展没有暴露可供其他扩展调用的外部消息接口
- 官方 `@playwright/mcp --extension` 在 Playwright Core 中把扩展 ID 和 `connect.html` 地址写死了
- 即使解决 token 审批，也无法从 Tactus 直接指定“当前 tab 就是目标页”

## MVP 能力边界

### 必做

- Tactus manifest 增加 `debugger` 权限
- background 建立到本地 relay 的 WebSocket 连接
- 使用当前 tab 或锁定 tab 作为默认 relay 绑定目标
- 本地 relay 把 CDP 命令在 Playwright 与 `chrome.debugger` 之间转发
- 对 `Target.setAutoAttach`、新 tab、新 target、跨 tab 切换做语义对齐
- 保持现有侧边栏风险确认与执行日志逻辑不变
- 保持现有 MCP HTTP 接入方式不变

### 暂不做

- 多 relay 会话调度
- 断线自动恢复到新 tab
- 用户态可视化“已绑定 tab”状态面板
- 将本地 relay 单独打包成独立 npm 包（后续计划见 `docs/superpowers/plans/2026-03-28-playwright-gateway-cli-packaging-plan.md`）

## 核心链路

```text
用户 -> Tactus sidepanel -> HTTP MCP -> 本地 gateway
     -> Playwright connectOverCDP -> 本地 relay /cdp
     -> Tactus background 内置 bridge -> chrome.debugger -> 当前 tab / 新 tab / 多 target
```

## 模块拆分

### 1. 本地 relay/gateway

在现有 `scripts/local-playwright-gateway.mjs` 基础上改为：

- 启动固定 relay 端口，默认 `8932`
- 暴露两个 WebSocket 路径：
  - `/cdp`
  - `/extension`
- 再启动官方 `@playwright/mcp`，但改走 `--cdp-endpoint`

### 2. Tactus background 内置 bridge

background 内新增 bridge 管理器：

- 接收 sidepanel 发来的“准备 Playwright bridge 上下文”消息
- 与本地 relay `/extension` 建立单一 WebSocket 连接
- 响应 relay 发来的 `attachToTab`、`forwardCDPCommand`
- 维护当前默认 tab 与 Playwright 新 target 的映射关系
- 通过 `chrome.debugger` 转发 CDP 事件与命令

### 3. sidepanel 接线

在 builtin Playwright gateway 连接前：

- 优先读取 `lockedTabId`
- 没有锁定时回退到当前活动 tab
- 先通知 background 准备默认 tab 绑定
- 再初始化 HTTP MCP 连接

### 4. 设置页与文档

调整文案：

- 去掉“安装官方 Bridge 扩展”
- 改成“启动本地 gateway”
- 明确说明当前方案使用 Tactus 内置 bridge

## 成功标准

- 用户不再需要安装第二个浏览器扩展
- 不再出现 `connect.html` 选页流程
- Playwright 工具既能落到当前 tab，也能处理新开的 tab / target
- 现有风险确认和日志展示继续工作
- 构建和类型检查通过
