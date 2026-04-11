# Tactus Browser Automation Visibility Controls Design

## Goal

为 Tactus 的原生浏览器自动化补一组用户可控的可见性设置，解决 `page-agent` 元素定位框在任务结束、异常终止或页面跳转后残留、影响观感的问题，同时保留自动化能力本身。

本次设计还要把“浏览器自动化入口是否对用户可见”做成通用设置，避免在不希望暴露自动化能力的场景里仍然显示侧边栏入口。

## Decisions

### 1. 新增两个通用设置项

在设置页增加一个“浏览器自动化”分组，包含两个布尔配置：

- `browserAutomationEnabled`
  - 默认值：`true`
  - 作用：浏览器自动化总开关
  - 控制项：
    - 侧边栏中【浏览器自动化模式】入口是否显示
    - `browser_*` 工具是否允许执行

- `browserAutomationHighlightEnabled`
  - 默认值：`false`
  - 作用：是否显示 page-agent 的元素定位框/序号标签
  - 控制项：
    - 仅影响元素定位框的可视渲染
    - 不影响 DOM 观察、元素索引、点击/输入/滚动等自动化能力

### 2. 总开关关闭时采用“强失效”策略

当 `browserAutomationEnabled = false` 时，不只是隐藏侧边栏入口，还要强制让自动化能力失效：

- 侧边栏不显示【浏览器自动化模式】入口
- 当前会话中的自动化模式视为关闭
- 历史会话里保存的 `automationEnabled` / `automationMode` 不再恢复为可用状态
- 所有 `browser_*` 工具在执行前直接返回“浏览器自动化已关闭”

这样可以避免“历史会话残留自动化状态，但当前产品设置已关闭”时出现行为不一致。

### 3. 元素定位框默认隐藏，但保留定位能力

不移除 `page-agent` 的元素高亮机制，也不改工具协议；只关闭其可见样式输出。

优先使用 `@page-agent/page-controller` 已暴露的高亮配置：

- `highlightOpacity: 0`
- `highlightLabelOpacity: 0`

在 `browserAutomationHighlightEnabled = false` 时使用上述配置，从而达到：

- LLM 仍然能通过 `[index]` 识别元素
- 运行时仍然能用 index 执行点击、输入、选择等动作
- 页面上不显示辅助框和序号标签

## Scope

### In Scope

- WXT storage 中新增两个自动化可见性配置
- 设置页新增“浏览器自动化”分组和两个开关
- 侧边栏根据总开关控制自动化入口显隐
- 侧边栏在总开关关闭时强制禁用 `browser_*` 工具
- content script 初始化 `PageController` 时根据配置控制高亮显示
- 配置切换时清理旧高亮残留
- 相关单元测试

### Out of Scope

- 修改 `browser_*` 工具协议
- 修改模型提示词中自动化能力的整体描述
- 新增更细粒度的自动化权限系统
- 重构 `page-agent` 包或替换执行引擎

## UX Design

### 设置页

在设置页的通用设置区域新增一个“浏览器自动化”分组，采用现有设置页风格，不额外引入新视觉系统。

分组内包含：

1. `启用浏览器自动化`
   - 文案说明：
     - 开启后，侧边栏会显示浏览器自动化入口，并允许模型调用 `browser_*` 工具
     - 关闭后，自动化入口隐藏，所有自动化工具不可用

2. `显示元素定位框`
   - 文案说明：
     - 开启后，在自动化观察和页面操作时显示元素定位框与序号标签
     - 关闭后，仍可使用自动化，但不显示页面辅助框

### 侧边栏

当 `browserAutomationEnabled = false` 时：

- 不渲染自动化模式 chip
- 不允许打开自动化模式弹窗
- 即使当前会话曾开启自动化，也按关闭状态处理

当 `browserAutomationEnabled = true` 时：

- 保持现有自动化入口与模式切换交互
- 仅在执行页面观察/操作时根据高亮开关决定是否显示元素定位框

## Implementation Design

### 1. Storage Layer

在 `utils/storage.ts` 中新增：

- `getBrowserAutomationEnabled`
- `setBrowserAutomationEnabled`
- `watchBrowserAutomationEnabled`
- `getBrowserAutomationHighlightEnabled`
- `setBrowserAutomationHighlightEnabled`
- `watchBrowserAutomationHighlightEnabled`

默认值：

- `browserAutomationEnabled = true`
- `browserAutomationHighlightEnabled = false`

### 2. Options Page

在 `entrypoints/options/App.vue` 中：

- 加载两个新设置项
- 提供切换 UI
- 保存时调用对应 storage setter

样式上沿用现有通用设置布局，不新增独立视觉模式，保持 Professional 风格。

### 3. Sidepanel

在 `entrypoints/sidepanel/App.vue` 中：

- 监听 `browserAutomationEnabled`
- 计算是否显示自动化入口
- 总开关关闭时：
  - 隐藏自动化入口
  - 将当前会话 automation state 视为关闭
  - 在执行 `browser_*` 工具前直接拦截

如果用户在总开关关闭后重新开启，再恢复现有自动化模式入口行为。

### 4. Content Script / PageController

在 `entrypoints/content.ts` 中初始化 `PageController` 时，根据设置注入高亮参数：

- 高亮开启：
  - 使用当前可见高亮配置
- 高亮关闭：
  - `highlightOpacity: 0`
  - `highlightLabelOpacity: 0`

另外需要在以下时机调用 `cleanUpHighlights()`：

- 高亮设置从开切到关时
- 内容脚本重新初始化时
- 自动化任务结束或切换页面后的下一次状态刷新前

目标是尽量清理旧高亮残留，避免历史页面残留辅助框。

## Data Flow

### 总开关

1. 用户在设置页切换 `browserAutomationEnabled`
2. WXT storage 同步到侧边栏
3. 侧边栏更新自动化入口显隐
4. 自动化工具执行前读取最新状态
5. 若关闭，则直接拒绝执行 `browser_*`

### 元素定位框开关

1. 用户在设置页切换 `browserAutomationHighlightEnabled`
2. WXT storage 同步到 content script
3. content script 更新 `PageController` 的高亮行为
4. 若由开变关，主动清理已有高亮

## Failure Handling

### 1. 历史会话与新设置冲突

如果会话记录里自动化开启，但总开关已关闭：

- UI 以总开关为准
- 不恢复自动化 chip 的可操作状态
- 工具执行时直接失败并返回明确提示

### 2. 第三方包高亮配置行为变化

若未来 `page-agent` 内部实现变化导致 `highlightOpacity: 0` 仍可见：

- 本次设计不额外增加 DOM hack
- 先维持最小侵入接入
- 如后续验证失效，再补充一层扩展侧样式兜底

### 3. 已残留的历史高亮框

配置切换、页面刷新、下一次自动化观察时应主动调用 `cleanUpHighlights()`。
不承诺清理“已经离开控制上下文且页面未再被触达”的所有旧标签页残留，但应显著降低残留概率。

## Testing

需要覆盖以下测试：

1. storage 默认值与 watch 行为
2. 总开关关闭时 `browser_*` 工具不可用
3. 总开关关闭时侧边栏不显示自动化入口
4. 高亮开关关闭时 `PageController` 使用零可见度配置
5. 高亮开关由开切到关时会触发高亮清理
6. 历史会话 automation state 在总开关关闭时不会被继续启用

## Acceptance Criteria

- 默认安装状态下，浏览器自动化入口可见，但元素定位框默认不显示
- 自动化任务执行时仍可正常观察、点击、输入、切换标签页
- 页面上不再出现明显的元素定位框残留
- 关闭“启用浏览器自动化”后，侧边栏不显示自动化入口，`browser_*` 工具全部不可用
- 重新开启总开关后，自动化入口和能力恢复正常
