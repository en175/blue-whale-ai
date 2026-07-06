# 040-context — 图像 Dock 生成数量下拉复刻（与视频一致）

## 背景
视频 Dock 的「生成数量」下拉已复刻为 fixed + Portal 浮层（见 039）。图像 Dock 的「1x」按钮此前是写死、不可点的（无 onClick、aria-expanded=false）。需补齐为与视频 Dock 一致的下拉交互。

## 改动（仅 `app/canvas/page.tsx`，ImageDockContent）

### 1. 新增数量状态
- `quantityRef`（按钮）、`quantityMenuRef`（浮层）
- `quantityOpen`、`quantity`（初值 "1x"）、`quantityPos`
- useEffect：打开时算 left/bottom；点击外部关闭（落在按钮或浮层内不关）

### 2. 数量按钮改为可交互
- 加 `ref`、`onClick`（切换开/关）、`aria-expanded={quantityOpen}`
- 文案从写死 `1x` 改为 `{quantity}`

### 3. 新增 fixed + Portal 浮层
与视频 Dock 完全一致：
- `createPortal(document.body)`
- `data-tc-dock-popover=""`、`role="listbox"`、`aria-label="选择生成数量"`
- 背景 `rgb(30,30,30)`、边框 `rgba(255,255,255,0.04)`、圆角 8、padding `4px 8px`、min-width 120
- 阴影 `rgba(0,0,0,0.25) 0px 4px 16px`、z-index `2147483602`
- 选项 `role="option"`/`aria-selected`，padding `7px 10px`、圆角 6、选中高亮
- 复用 `QUANTITIES`（1x/2x/3x/4x）

## 不动的部分
- 图像 Dock 其它部分（顶部、模型 Pill、积分生成）
- 视频 Dock 完全不动
- `ImageModelSettingsPopover` 不动

## 验证
- `npx tsc --noEmit` 通过。
- Playwright（临时脚本，已删除）：
  - /canvas → AI 图片 → 点 1x → 浮层 4 档、首项选中
  - 切 4x → 按钮显示 4x

## 关键文件
- `app/canvas/page.tsx`

## 备注
- 至此图像 Dock 与视频 Dock 的「生成数量」下拉在交互与视觉上完全一致。
