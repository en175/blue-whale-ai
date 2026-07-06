# 画布右侧 AgentChat 面板整体自查与修复

## 自查结论

作为十年前端工程师，对照参考 outer HTML 对当前 `AgentChatPanel` 进行了整体自查。整体还原度较高，但在属性层面发现 2 处明确不一致。

## 发现的问题

### 1. 模型设置按钮 `title` 与参考不符

- 参考：`aria-label="模式与模型: Agent · Qwen 3.7 Max"`，`title="模式与模型"`
- 当前：`title` 被错误地写成了 `"模式与模型: Agent · Qwen 3.7 Max"`
- 影响：`title` 会触发浏览器原生 tooltip，与参考不一致。

### 2. 技能按钮缺少 `data-tour-target`

- 参考：`data-tour-target="agent-skill-button"`
- 当前：缺少该属性
- 影响：tour / 自动化定位可能异常。

### 3. 其他 minor 差异（暂不改动）

- composer 裁剪方式：参考是单个 div 直接 `clip-path: path(...)`，当前使用 `SmoothCorners` + 内部 `rounded-[25.2px]`，视觉上几乎等价。
- 顶部 chrome 按钮：参考有 `data-slot="smooth-corners"`，当前使用 inline `clip-path`，视觉上等价。
- 面板外壳字体：参考显式 `font-family: Inter, ...`，当前依赖继承。
- 面板外层阴影：当前外层 panel 有额外 `box-shadow: 0 16px 48px rgba(0,0,0,0.5)`，参考 outer HTML 未体现。

## 修复内容

- 文件：`app/canvas/page.tsx`
  - 将模型设置按钮的 `title` 从 `"模式与模型: Agent · Qwen 3.7 Max"` 改回 `"模式与模型"`。
  - 为技能按钮新增 `data-tour-target="agent-skill-button"`。

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 启动生产服务，运行 `node screenshot-agent-panel.mjs` 更新面板截图。
- 运行临时属性检查脚本确认：
  - 技能按钮 `data-tour-target="agent-skill-button"` 已存在。
  - 模型按钮 `aria-label="模式与模型: Agent · Qwen 3.7 Max"`，`title="模式与模型"` 与参考一致。

## 相关文件

- `app/canvas/page.tsx`
- `docs/agent-panel-open.png`
- `docs/agent-panel-closed.png`
- `docs/agent-panel-reopened.png`
