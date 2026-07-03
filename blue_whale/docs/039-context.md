# 039-context — 视频 Dock 生成数量下拉浮层复刻（fixed + 4 档）

## 背景
参考稿给出点击底部「生成数量 1x」按钮后弹出的下拉浮层。需复刻为 fixed 浮层，并把档位改成 4 档。

## 参考稿要点
- `position: fixed`，由数量按钮定位 left/bottom
- `data-tc-dock-popover=""`、`role="listbox"`、`aria-label="选择生成数量"`
- 背景 `rgb(30,30,30)`、边框 `rgba(255,255,255,0.04)`、圆角 8、padding `4px 8px`
- 阴影 `rgba(0,0,0,0.25) 0px 4px 16px`、z-index `2147483602`、min-width 120、gap 0
- 进场 opacity+scale，250ms，origin left bottom
- 选项：`role="option"`、`aria-selected`；padding `7px 10px`、圆角 6、font 12/16、transition 80ms
  - 选中：bg `rgba(255,255,255,0.08)`、color `rgba(255,255,255,0.85)`、weight 500
  - 未选中：bg transparent、color `rgba(255,255,255,0.45)`、weight 400
- 档位：1x / 2x / 3x / 4x（共 4 档）

## 改动（仅 `app/canvas/page.tsx`）

### 1. QUANTITIES 改为 4 档
```ts
const QUANTITIES = ["1x", "2x", "3x", "4x"];
```
（原为 `["1x","2x","4x"]`）

### 2. 拆分 quantityRef（修复 ref 复用坑）
- 新增 `quantityMenuRef`（浮层）+ `quantityPos` state
- 新增 useEffect：打开时用数量按钮 `quantityRef` 的 rect 算 left/bottom
- 点击外部关闭：落在按钮或浮层内不关，否则关

### 3. 浮层改为 fixed + Portal
- `createPortal(document.body)`，避免被 Dock clipPath 裁剪
- 容器与选项样式严格按参考稿
- `role="listbox"` / `role="option"` / `aria-selected`

## 不动的部分
- 数量按钮本体（样式已与参考稿一致）
- 顶部、底部控制条其它部分、模型设置浮层、全能参考下拉、首尾帧顶部
- `optionButtonStyle`（仍被 modelSettings 子下拉用）保留
- 图像 Dock 不动

## 验证
- `npx tsc --noEmit` 通过。
- Playwright（临时脚本，已删除）：
  - 点 1x → 浮层出现，档位数 4（1x/2x/3x/4x），首项 aria-selected=true。
  - 切 3x → 按钮显示 3x。

## 关键文件
- `app/canvas/page.tsx`

## 备注
- 至此视频 Dock 的三个下拉浮层（全能参考 036、模型设置 037、生成数量 本篇）均已统一为 fixed + Portal 方案，视觉一致。
