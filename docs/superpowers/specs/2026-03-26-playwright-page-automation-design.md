# Playwright 当前页自动化设计说明

**目标**

在 Tactus 现有 HTTP MCP 能力基础上，新增一条围绕 Playwright MCP 的可落地自动化链路，让用户可以在右侧侧边栏输入自然语言，由左侧当前浏览器标签页执行自动化操作，同时对高风险动作进行确认并记录执行过程。

## 方案结论

首版采用“官方 Playwright MCP + 本地启动包装 + Tactus 接入增强”的混合方案：

- 本地能力层复用官方 `@playwright/mcp`
- 使用 `--extension` 模式连接官方 Playwright MCP Bridge 扩展，以绑定当前浏览器标签页
- 通过 `--port` 暴露本地 HTTP MCP 地址，继续走 Tactus 已有的 HTTP MCP 接入能力
- 暂不接入 Chrome DevTools Adapter

## 为什么不采用 Chrome remote debugging 直连

- 从 Chrome 136 起，默认用户资料目录不再支持直接通过 `--remote-debugging-port` / `--remote-debugging-pipe` 暴露调试入口
- 这会让“直接附着用户日常正在使用的默认浏览器环境”变得不稳定
- 强推用户改启动参数或改用独立 profile，会破坏“右侧输入、左侧原页面执行”的体验

## 首版能力边界

### 必做

- 提供本地 Playwright gateway 的统一启动方式
- 在设置页中快速添加本地 Playwright MCP 配置
- 在侧边栏中对 Playwright MCP 工具执行风险分级
- 对高风险操作弹出确认卡片
- 记录并展示执行日志
- 保持现有 MCP 接入方式不变

### 暂不做

- 自研浏览器桥接协议
- Chrome DevTools Adapter
- 多会话、多浏览器实例调度
- 自动启动本地进程

## 核心链路

```text
用户 -> Tactus 侧边栏 -> Tactus toolExecutor -> HTTP MCP
     -> local Playwright gateway -> Playwright MCP Bridge -> 当前浏览器标签页
```

## 模块拆分

### 1. 本地 gateway 启动包装

新增本地脚本，统一启动官方 Playwright MCP：

- 默认监听 `http://127.0.0.1:8931/mcp`
- 默认使用 `--extension`
- 默认使用 `--shared-browser-context`
- 允许后续追加 CLI 参数

### 2. 设置页增强

新增“本地 Playwright Gateway”引导卡片：

- 一键填入默认 MCP Server 配置
- 展示默认地址
- 展示启动命令
- 提示需要先安装 Playwright MCP Bridge 扩展

### 3. 风险分级

对 Playwright MCP 的 `browser_*` 工具做分级：

- 低风险：读取、快照、截图、普通填写
- 中风险：导航、关闭标签、拖拽、上传文件、普通点击
- 高风险：提交、删除、发送、支付、确认弹窗接受、自定义代码执行

高风险动作在真正调用 MCP 前必须二次确认。

### 4. 执行日志

日志按当前会话保存，至少包含：

- 工具名
- 操作摘要
- 风险级别
- 当前状态
- 时间
- 结果摘要或错误

## UI 设计原则

沿用当前 Professional 风格：

- 保持现有卡片、标签、按钮、边框和提示色体系
- 不引入新的视觉语言
- 风险确认弹窗与脚本确认弹窗保持同一套层级和交互节奏

## 首版成功标准

- 用户可以按文档启动本地 gateway
- 用户可在设置页快速接入本地 Playwright MCP
- 用户在侧边栏发出自动化指令后，模型能够调用 Playwright MCP 工具
- Playwright 操作落到当前已绑定的浏览器标签页
- 高风险动作会被拦截确认
- 用户能看到执行步骤与结果
