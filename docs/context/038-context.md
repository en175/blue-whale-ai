# 038-context — 视频 Dock「首尾帧」模式顶部复刻

## 背景
参考稿给出视频 Dock 选「首尾帧」参考模式时的输入框样式。与「全能参考」模式不同，首尾帧模式顶部不是「参考图片·视频·音频」三按钮，而是「首帧 + 交换按钮 + 尾帧」三槽位，占位文案也不同。

## 参考稿要点（首尾帧模式）
- 顶部外层：`flex; align-items:flex-start; gap:8px; padding:0 32px 0 4px`
- 内层一行：`flex; align-items:center; gap:8px; flex:1 1 0%; min-width:0`
  - 首帧槽位：48x48、虚线 1.5px、圆角 12、bg `rgba(255,255,255,0.04)`、IconPlus(opacity0.4) + 「首帧」(9px/0.25)
  - 交换按钮：26x26 圆形、bg `rgba(255,255,255,0.08)`、ArrowLeftRight 图标
  - 尾帧槽位：同首帧，label「尾帧」
- 占位文案：`请描述你想生成的视频内容。`

## 改动（仅 `app/canvas/page.tsx`）

### 1. 新增 FrameUploadButton 组件
48x48 虚线上传槽位，含隐藏 file input（accept jpg/png）+ IconPlus + 标签。位于 MediaUploadButton 下方。

### 2. 补导入 ArrowLeftRight
lucide-react 原未导入，新增。

### 3. 顶部区域按 refMode.id 切换
- `refMode.id === "first-last"`：渲染首帧 + 交换按钮 + 尾帧。
- 否则（omni 全能参考）：保持原有「参考图片·视频·音频」三按钮不变。

### 4. 占位文案按 refMode 切换
- 首尾帧：`请描述你想生成的视频内容。`
- 全能参考：保持 `上传 3-10 秒视频片段…`（不变）。

## 产品确认
- ✅ 按 refMode 切换顶部（不永久显示首尾帧，避免破坏全能参考样式）。
- ✅ 不加「原生音频」开关（参考稿高级设置块里有，但当前块折叠不可见，按「无关不动」原则保持现状）。

## 不动的部分
- 底部控制条（上传图片、首尾帧按钮、模型Pill、1x、积分生成）、联网搜索块、模型设置浮层、全能参考下拉。
- 全能参考模式顶部（已确认一致）。
- 图像 Dock。

## 验证
- `npx tsc --noEmit` 通过。
- Playwright（临时脚本，已删除）：
  - 默认全能参考：参考图片/视频/音频按钮在，占位文案「上传 3-10 秒视频片段…」。
  - 切首尾帧：首帧/尾帧/交换按钮出现，占位文案「请描述你想生成的视频内容。」，全能参考三按钮消失。

## 关键文件
- `app/canvas/page.tsx`

## 备注
- 首帧/尾帧的 file input 当前未接 onChange（与 MediaUploadButton 一致，纯视觉还原）。
- 交换按钮当前未接 onClick（无实际交换逻辑，纯视觉）。
