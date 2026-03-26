[English](README.md) | 简体中文

# ![icon](public/icon/32.png) Tactus

**首个支持 Agent Skills 的浏览器 AI Agent 扩展**

[![Chrome Version][chrome-version-shield]][chrome-store-link]
[![Chrome Users][chrome-users-shield]][chrome-store-link]
[![Firefox Version][firefox-version-shield]][firefox-store-link]
[![Firefox Users][firefox-users-shield]][firefox-store-link]

Tactus 是一款创新的浏览器扩展，将 [Agent Skills](https://agentskills.io/specification) 规范引入浏览器环境，让 AI Agent 能够通过可扩展的技能系统执行复杂任务。

触发 skills 可实现特定场景的提示词注入，常用工作流可封装在脚本中执行，代替 AI Agent 重复的自动化操作，既快速又省token。

<!-- 演示动图 -->
![Tactus 演示](resources/trust-skill.png)
![Tactus 演示](resources/show-result.png)

## ✨ 核心特性

### 🧩 Agent Skills 系统

Tactus 是首个在浏览器扩展中实现 Agent Skills 规范的产品：

- **技能导入** - 支持导入符合规范的 Skill 文件夹，包含指令、脚本和资源文件
- **脚本执行** - 在页面中安全执行 JavaScript 脚本
- **信任机制** - 首次执行脚本需用户确认，可选择永久信任

<!-- Skills 导入演示 -->
![Skills 导入演示](resources/add-skill.png)

### 🤖 智能对话

- **多服务商原生支持** - 原生支持 Anthropic (Claude)、Gemini (Google) 及任何 OpenAI 兼容 API 服务商
- **多模型切换** - 配置多个服务商，随时切换模型
- **流式响应** - 实时显示 AI 回复，支持思维链展示
- **ReAct 范式** - 内置完整工具调用循环，AI 自主决策何时使用工具
- **终止生成** - 随时中断正在进行的 AI 生成或工具调用
- **标签页锁定** - AI 回复时自动锁定标签页并显示发光动画，防止误切页面
- **预设快捷操作** - 对话面板中的常用提示词快捷按钮

### 🖼️ 图像视觉支持

- **视觉模型配置** - 按模型独立配置是否启用视觉能力
- **粘贴图片** - 在对话输入框中直接粘贴图片发送给 AI
- **多模态对话** - 支持图文混合提问，让 AI 理解页面截图、图表等视觉内容

<!-- 图像视觉演示 -->
![图像视觉演示](resources/identify-image.png)

### 📄 页面理解

- **智能提取** - 使用 Readability + Turndown 提取页面核心内容并转换为 Markdown
- **选中引用** - 选中页面文字或侧边栏文字后一键引用提问
- **上下文感知** - AI 自行判断是否调用网页提取工具，如果 skill 脚本有提供则不会重复提取
- **原始提取模式** - 支持配置特定网站跳过 Readability 算法，直接提取页面原始内容

<!-- 页面交互演示 -->
![页面交互演示](resources/page-interaction.png)

### 🔌 HTTP MCP 支持

通过 [Model Context Protocol](https://modelcontextprotocol.io/) 连接外部工具服务器，扩展 AI 的能力边界：

- **MCP Server 连接** - 添加并管理多个 HTTP MCP Server
- **动态工具发现** - 自动从 MCP Server 获取可用工具并集成到对话中
- **本地 Playwright Gateway** - 可接入本地 Playwright MCP HTTP 服务，通过 Tactus 内置 bridge 将自动化绑定到当前浏览器标签页
- **多种认证方式**：
  - 无认证（公开服务）
  - Bearer Token 认证
  - OAuth 2.1 认证（含自动刷新）

<!-- Notion MCP 演示视频 -->
https://github.com/user-attachments/assets/c7737e7e-dd2e-4888-a030-db40b9731f1d

### 🎨 主题与个性化

- **主题切换** - 支持浅色、深色、跟随系统三种主题模式
- **悬浮球开关** - 可自由开启/关闭页面右侧悬浮球
- **划词引用开关** - 可自由开启/关闭划词引用功能
- **国际化** - 支持中英文界面切换

### 💾 本地存储

- **会话管理** - 对话历史本地存储，支持分页加载
- **消息编辑** - 支持编辑已发送的用户消息并重新生成回复
- **消息复制** - AI 回复支持一键复制
- **IndexedDB** - Skills 和文件存储在本地数据库
- **隐私优先** - 所有数据保存在本地，不上传任何服务器

### ⚙️ 高级配置

- **网页内容字数限制** - 可配置提取页面内容的最大字数，控制 token 消耗
- **工具调用次数限制** - 可配置 Agent 单次对话中工具调用的最大次数，防止无限循环
- **Base URL 智能处理** - 自动补全 `/v1/chat/completions` 路径，简化 API 配置
- **API 端点预览** - 在 Base URL 输入框下方预览完整的 API 端点地址
- **配置自动保存** - 模型服务商配置和 MCP Server 配置支持自动保存（防抖）
- **链接新标签页打开** - AI 回复中的链接在新标签页打开，保留当前对话

## 🚀 快速开始

### 下载安装

| 浏览器 | 下载 |
| ------ | ---- |
| Chrome | [Chrome 网上应用店][chrome-store-link] |
| Firefox | [Firefox 附加组件][firefox-store-link] |

或从 [GitHub Releases](https://github.com/Castor6/tactus/releases) 下载手动安装。

### 手动安装
- Chrome / Edge（推荐）
  - 在固定目录解压 `tactus.zip`
  - 在 Chrome 中打开 `chrome://extensions/`
  - 启用 `开发者模式`（右上角）
  - 点击 `加载未打包的扩展程序`（左上角）
  - 选择已解压的 `tactus` 文件夹
- Firefox（临时调试安装）
  - 运行 `npm run build:firefox`
  - 打开 `about:debugging#/runtime/this-firefox`
  - 点击 `临时载入附加组件`
  - 选择 `.output/firefox-mv2/manifest.json`

## 🛠️ 从源代码构建

1. 克隆仓库
```bash
git clone https://github.com/Castor6/tactus.git
cd tactus
```

2. 安装依赖
```bash
npm install
```

3. 开发模式运行
```bash
npm run dev
npm run dev:firefox
```

4. 构建生产版本
```bash
npm run build
npm run build:firefox
```

5. 请使用 `.claude\skills\design-style` skills 中的 Professional 风格，以统一扩展的 UI 风格设计

## 📖 使用指南

### 配置 AI 服务商

1. 点击扩展图标打开侧边栏
2. 点击设置按钮进入配置页面
3. 添加 API 服务商（填写名称、API 地址、密钥）
4. 获取模型列表并选择模型
5. 如需视觉能力，在模型设置中启用视觉配置

<!-- 配置演示 -->
![配置演示](resources/set-llm.png)

### 导入 Skill

1. 在设置页面找到 Skills 管理区域
2. 点击"导入 Skill"按钮
3. 选择包含 `SKILL.md` 的文件夹
4. 确认导入后即可在对话中使用

### 配置 MCP Server

1. 在设置页面找到 MCP 管理区域
2. 点击添加 MCP Server
3. 填写 Server URL 并选择认证方式
4. 连接成功后，MCP 提供的工具将自动集成到对话中

### 配置本地 Playwright Gateway

1. 在电脑终端后台启动本地 gateway：

   - macOS
   ```bash
   nohup npm run mcp:playwright -- --host localhost --port 8931 --relay-port 8932 > ~/playwright-mcp.log 2>&1 &
   ```
   - Windows PowerShell
   ```powershell
   Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','npm run mcp:playwright -- --host localhost --port 8931 --relay-port 8932'
   ```

2. 打开 Tactus 设置页，在 `MCP 配置` 中查看开启说明
3. Tactus 会自动探测 `http://localhost:8931/mcp`
4. 如需保留为手动 MCP 配置，可点击 `保存为 MCP 配置`
5. 真正执行 Playwright 工具前，Tactus 会自动通过内置 bridge 绑定当前标签页

### 关闭本地 Playwright Gateway

- macOS
```bash
PID=$(lsof -ti :8931 -ti :8932 | sort -u) && [ -n "$PID" ] && kill $PID
```

- Windows PowerShell
```powershell
$pids = @(Get-NetTCPConnection -LocalPort 8931,8932 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ } }
```

这样就能保持“右侧 Tactus 输入，左侧当前浏览器页面执行”的交互方式，同时不再需要安装第二个浏览器扩展。

### Skill 文件夹结构

```
my-skill/
├── SKILL.md          # 必需：技能定义和指令
├── scripts/          # 可选：可执行脚本
│   └── fetch-data.js
├── references/       # 可选：参考文档
│   └── api-docs.md
└── assets/           # 可选：资源文件
    └── template.json
```

### SKILL.md 格式

```markdown
---
name: my-skill
description: 这是一个示例技能
---

# 技能指令

当用户需要执行某任务时，按以下步骤操作：

1. 首先分析用户需求
2. 调用 scripts/fetch-data.js 获取数据
3. 整理并返回结果
```

## 🛠️ 技术栈

- **框架**: [WXT](https://wxt.dev/) - 现代浏览器扩展开发框架
- **前端**: Vue 3 + TypeScript
- **AI 集成**: 原生 Anthropic (Claude) API、原生 Gemini (Google) API、OpenAI SDK（兼容任意 OpenAI API）
- **MCP 支持**: @modelcontextprotocol/sdk - Model Context Protocol 客户端
- **内容提取**: @mozilla/readability + turndown
- **存储**: IndexedDB (idb) + WXT Storage
- **认证**: OAuth 2.1 支持（用于 MCP Server 认证）

## 🔧 内置工具

Tactus 为 AI 提供以下内置工具：

| 工具 | 描述 |
|------|------|
| `extract_page_content` | 提取当前页面的主要内容 |
| `activate_skill` | 激活指定的 Skill |
| `execute_skill_script` | 执行 Skill 中的脚本 |
| `read_skill_file` | 读取 Skill 中的文件内容 |
| **MCP 工具** | 从已连接的 MCP Server 动态获取的工具 |

## 📝 开发

### 项目结构

```
tactus/
├── entrypoints/
│   ├── background.ts      # 后台脚本
│   ├── content.ts         # 内容脚本
│   ├── sidepanel/         # 侧边栏 UI
│   └── options/           # 设置页面
├── components/            # Vue 组件
├── utils/
│   ├── anthropic.ts       # Anthropic (Claude) API 集成
│   ├── api.ts             # API 调用与工具执行
│   ├── db.ts              # IndexedDB 操作
│   ├── gemini.ts          # Gemini (Google) API 集成
│   ├── storage.ts         # 设置与存储管理
│   ├── i18n.ts            # 国际化
│   ├── mcp.ts             # MCP Client 管理
│   ├── mcpOAuth.ts        # MCP OAuth 2.1 认证
│   ├── mcpStorage.ts      # MCP 配置存储
│   ├── skills.ts          # Skills 核心逻辑
│   ├── skillsExecutor.ts  # 脚本执行器
│   ├── skillsImporter.ts  # Skills 导入
│   ├── tools.ts           # 工具定义
│   └── pageExtractor.ts   # 页面内容提取
└── public/                # 静态资源
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 🚧 未来发展路线图

我们对 Tactus 的未来发展有着激动人心的计划：
- [ ] 引入 CDP 自动化作为 Agent 的工具，可人工接管介入
- [ ] 操作录制一键生成可复用的 skills
- [ ] 长时稳定自动化任务挑战

## 📄 许可证

Apache-2.0 License

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Castor6/tactus&type=Date)](https://star-history.com/#Castor6/tactus&Date)

## 友情链接
感谢 [LINUX DO](https://linux.do/) 佬友们的支持与反馈，让我们一起在 tactus 玩起来越来越好！

---

**Tactus** - 赋予 AI 触觉，代你行走网络 🚀

<!-- LINK GROUP -->
[chrome-store-link]: https://chromewebstore.google.com/detail/tactus/nmhndbemnmmigjooiafblchoegecmkhh
[chrome-version-shield]: https://img.shields.io/chrome-web-store/v/nmhndbemnmmigjooiafblchoegecmkhh?style=flat-square&label=Chrome&labelColor=black&color=blue
[chrome-users-shield]: https://img.shields.io/badge/Chrome%20Users-120-blue?style=flat-square&labelColor=black
[firefox-store-link]: https://addons.mozilla.org/firefox/addon/tactus
[firefox-version-shield]: https://img.shields.io/amo/v/tactus?style=flat-square&label=Firefox&labelColor=black&color=orange
[firefox-users-shield]: https://img.shields.io/amo/users/tactus?style=flat-square&label=Firefox%20Users&labelColor=black&color=orange

