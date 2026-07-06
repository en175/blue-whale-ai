# 036-context — 视频 Dock「全能参考」下拉框复刻为 fixed 浮层

## 背景
参考稿给出了点击「全能参考」按钮后弹出的下拉框样式与内容。需严格复刻：浮层定位、毛玻璃、圆角、间距、选中态，以及只保留「首尾帧 / 全能参考」两项。

## 参考稿要点
- `position: fixed`，定位在按钮上方（left=按钮左，bottom=按钮顶上方）。
- 背景 `rgba(41,41,41,0.92)` + `backdrop-filter: blur(40px)`。
- 边框 `1px solid rgba(255,255,255,0.04)`，圆角 8，padding `8px 4px`。
- 阴影 `rgba(0,0,0,0.6) 0px 8px 24px`，z-index `2147483602`。
- 进场：opacity + scale，250ms cubic-bezier(0.16,1,0.3,1)，transform-origin: left bottom。
- 选项：padding `8px 16px`，圆角 4，gap 8，text-align left，font-size 12。
  - 选中：bg `rgba(255,255,255,0.08)`、color `#fff`、weight 600、transition 180ms。
  - 未选中：bg transparent、color `rgba(255,255,255,0.7)`、weight 500、transition 100ms。
- 内容只显示两项：`全能参考`、`首尾帧`。

## 改动（仅 `app/canvas/page.tsx`）

### 1. REF_MODES 删除「Text to Video」
按产品确认，只保留两项：
```ts
const REF_MODES = [
  { id: "omni", label: "全能参考" },
  { id: "first-last", label: "首尾帧" },
];
```

### 2. 顶部导入 createPortal
新增 `import { createPortal } from "react-dom";`（与图像弹窗同款，避免被 Dock clipPath 裁剪）。

### 3. VideoDockContent 浮层逻辑
- 新增 `refModeMenuRef`（浮层）和 `refModePos` state。
- 新增 useEffect：打开时用 `refModeRef`（按钮容器）的 `getBoundingClientRect()` 计算 `left / bottom`。
- 点击外部关闭逻辑调整：点击落在按钮或浮层内都不关，否则关闭（之前浮层复用 refModeRef，改 fixed 后需单独判断）。

### 4. 下拉 JSX 改为 fixed + Portal
- 渲染条件：`refModeOpen && typeof document !== "undefined"` 时 `createPortal(... , document.body)`。
- 浮层根节点加 `data-tc-tab-dropdown-menu="true"`（与参考稿属性一致）。
- 容器与选项样式严格按参考稿。
- 选中态 `selected = refMode.id === m.id`；点选项后 `setRefMode(m)` + 关闭。

## 不动的部分
- 「全能参考」按钮本身（上一轮的 `{refMode.label}` 绑定保留）。
- 顶部三按钮、输入框、占位文案、底部模型 Pill、1x、积分生成按钮、联网搜索块。
- `optionButtonStyle` 仍被模型设置 / 数量下拉使用，保留不动。
- 图像 Dock 完全不动。

## 验证
- `npx tsc --noEmit` 通过。
- Playwright（临时脚本，已删除）：
  - 打开 /canvas → AI 视频 → 点「全能参考」。
  - 浮层出现，项数 = 2，文案 = [全能参考, 首尾帧]。
  - 截图与参考稿比对：毛玻璃、圆角、左下角定位、选中项高亮一致。
  - 点「首尾帧」后浮层关闭、按钮文案同步切换。

## 关键文件
- `app/canvas/page.tsx`

## 备注
- 该浮层与图像模型设置弹窗（`docs/033-context.md`）都使用 Portal + fixed 的相同方案，保持一致。
