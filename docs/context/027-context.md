# 027-context — 顶部左侧状态栏按参考复刻并增加项目下拉菜单

## 目标
按参考 HTML 严格复刻画布左上角状态栏（Logo、项目日期、设置按钮），并实现点击项目日期后展开的 Projects 下拉菜单。

## 实现

### 1. 重构 `TopBar` 组件
- 外层容器从圆角药丸（`bg-[#141414]/90` + `border-white/[0.04]` + `rounded-[18px]`）改为紧凑磨砂条：
  - `background: rgba(0, 0, 0, 0.55)`
  - `backdrop-filter: blur(12px)`
  - `border-radius: 10px`
  - `padding: 2px`
  - `gap: 4px`
- Logo 按钮：移除固定宽高和背景，内部 SVG 包裹在 `transform: scale(0.85)` 的 div 中。
- 分隔线：改为 `width: 1px; height: 14px; background: rgba(255,255,255,0.16)`。
- 项目/日期按钮：改为深色小按钮样式：
  - `background: rgba(42, 42, 45, 0.72)`
  - `border-radius: 8px`
  - `padding: 4px 8px`
  - `font-size: 14px`
  - `font-weight: 600`
- 设置按钮：改为 28×28 透明小按钮，使用 `lucide-settings` 图标（stroke-width 1.5）。

### 2. 新增 `ProjectMenu` 组件
- 点击项目日期按钮展开/收起。
- 点击外部自动关闭（`useEffect` + `mousedown` 监听）。
- 菜单结构严格复刻参考：
  - 标题 "Projects"
  - 项目列表（当前选中项高亮 `rgba(255,255,255,0.12)`）
  - 每项包含缩略图、项目名称、悬浮显示的删除按钮（Trash2）
  - 底部 "Rename Project"（Pencil 图标）
  - 底部 "New Project"（IconPlus 图标）
- 缩略图使用 Unsplash 占位图，空缩略图使用参考中的网格线 SVG。

### 3. 常量
- 在 `app/canvas/page.tsx` 内新增 `PROJECTS` 数组与 `Project` 类型。

## 关键文件

- `app/canvas/page.tsx`
  - `TopBar` 组件
  - 新增 `ProjectMenu` 组件
  - `PROJECTS` 常量与 `Project` 类型
  - 新增 `Pencil`、`Trash2` 的 lucide 导入

## 验证

- `npm run build` 通过，无 TypeScript 错误。
- Playwright 截图 `screenshots/top-bar.png` 确认左上角状态栏与展开菜单均符合参考布局。

## 备注

- 项目列表为硬编码示例数据，后续可替换为真实项目接口。
- 删除/重命名/新建按钮目前仅做视觉交互，未绑定实际业务逻辑。
