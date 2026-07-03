# 037-context — 视频 Dock 模型设置浮层复刻（模型与质量 + 时长滑块 + 宽高比）

## 背景
参考稿给出了视频 Dock 点击底部「模型 Pill」后弹出的浮层。结构与之前的 4 列文字列表完全不同，需整体重写。

## 参考稿结构
1. **模型与质量**：模型下拉（224 宽）+ 分辨率下拉（flex1）。
2. **时长滑块**：range 4s–15s，每秒一档共 12 刻度，当前 10s。
3. **宽高比**：6 个按钮（9:16/3:4/1:1/4:3/16:9/21:9），带 AspectRatioIcon。

## 改动（`app/canvas/page.tsx` + `app/globals.css`）

### 1. 时长数据模型改为滑块
- 删除 `VIDEO_DURATIONS`（原 5s/10s/15s 三档）。
- 新增 `VIDEO_DURATION_MIN=4`、`VIDEO_DURATION_MAX=15`、`VIDEO_DURATION_STEP=1`、`VIDEO_DURATION_TICKS`（4..15 数组）。
- `BottomDock` 的 `duration` state：`{id,label}` → `number`，初值 `10`。
- `VideoDockContentProps`：`duration: number`、`setDuration: (s:number)=>void`。
- 底部 Pill 里 `{duration.label}` → `{duration}s`。

### 2. 浮层重写为 fixed + Portal
- `position: fixed`，由 Pill 按钮 ref 计算 `left/bottom`。
- `createPortal(document.body)`，避免被 Dock clipPath 裁剪。
- 背景 `rgb(30,30,30)`、边框 `rgba(255,255,255,0.04)`、圆角 8、padding `4px 8px`。
- 阴影 `rgba(0,0,0,0.25) 0px 4px 16px`、z-index `2147483602`、gap 12。
- 进场 opacity+scale，250ms，origin left bottom。
- 新增 `modelSettingsMenuRef` + `modelSettingsPos` state；点击外部关闭逻辑把浮层纳入判断。

### 3. 区块 A：模型与质量
- 模型下拉：224 宽、高 36、圆角 8、border `rgba(255,255,255,0.08)`、bg `rgba(255,255,255,0.04)`；文字 weight600；右 ChevronDown(opacity0.6)。**按确认不加 logo**。展开 VIDEO_MODELS 列表，选中项高亮。
- 分辨率下拉：flex1 min-width 224，同上样式；展开 VIDEO_RESOLUTIONS。
- 子下拉用组件内 `modelDropdownOpen` / `resolutionDropdownOpen` state 控制，互斥（开一个关另一个）。

### 4. 区块 B：时长滑块
- 头部「时长」+ 当前值（如 10s）。
- `<input type="range" min=4 max=15 step=1>`，progress 由 CSS 变量 `--tc-duration-slider-progress` 计算（linear-gradient 填充）。
- 12 个刻度点，当前值高亮 `--active`。
- 底部 limits：4s / 15s。
- 改值 `setDuration(value)`，不关闭浮层。

### 5. 区块 C：宽高比
- 容器 bg `rgba(255,255,255,0.04)`、圆角 8、padding 4、gap 2。
- 6 个按钮：AspectRatioIcon + 文字；选中态 bg `rgba(255,255,255,0.08)`/白字/weight600。
- 复用共享 `AspectRatioIcon`（`components/icons/AspectRatioIcon.tsx`），新增 import。

### 6. CSS（`app/globals.css`）
新增 `.tc-duration-slider__*` 系列：input range 美化、track 渐变、thumb（webkit/moz）、刻度点、active、limits。

## 不动的部分
- 顶部三按钮、输入框、占位文案、底部 Pill 结构、1x、积分生成、联网搜索块、全能参考下拉。
- 图像 Dock 完全不动。
- `optionButtonStyle` 仍被数量下拉用，保留。

## 验证
- `npx tsc --noEmit` 通过。
- Playwright（临时脚本，已删除）：
  - /canvas → AI 视频 → 点模型 Pill。
  - 浮层出现，含「模型与质量 / 时长 / 宽高比」三块。
  - 滑块 min=4 max=15 value=10。
  - 拖滑块到 15s → 关闭浮层 → 底部 Pill 时长显示 15s。

## 踩坑记录
- 初版验证脚本用选择器 `[data-tc-dock-popover="true"]` 找不到浮层，因为 JSX 写的是 `data-tc-dock-popover=""`（空值）。改用 `[data-tc-dock-popover]`（无值匹配）后正常。浮层本身一直正常打开，只是测试选择器写错。

## 关键文件
- `app/canvas/page.tsx`
- `app/globals.css`

## 备注
- 视频 Dock 现有三个 fixed Portal 浮层：全能参考下拉（036）、模型设置浮层（本篇）、数量下拉（仍是 Dock 内 relative，未在本期范围）。
