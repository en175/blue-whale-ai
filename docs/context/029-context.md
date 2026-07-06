# 029-context — 修复 Agent 面板重新打开后背景颜色缺失

## 问题
右侧 `Agent` 对话面板在默认打开时背景颜色正常；点击顶部 `Agent` 按钮关闭面板后再次打开，背景颜色（半透明毛玻璃外壳）会缺失，只剩下面板内容浮在画布上。

## 根因
`AgentChatPanel` 使用 `ResizeObserver` 监听 `panelRef` 的尺寸变化，并把结果写入 `panelSize` 状态。`panelSize` 再作为 `SmoothCorners` 外壳的宽高输入，控制背景毛玻璃壳的大小。

面板关闭再重新打开时，`ResizeObserver` 会连续触发两次回调：

1. 第一次：`contentRect` 为正常尺寸（如 `468×762`）。
2. 第二次：`contentRect` 为 `0×0`（面板重新进入布局/动画时的瞬时状态）。

第二次 `0×0` 把 `panelSize` 覆盖成 `{ w: 0, h: 0 }`，导致 `SmoothCorners` 生成的背景壳被压成 `0×0`，背景颜色/毛玻璃效果随之消失。

## 修复

在 `app/canvas/page.tsx` 的 `AgentChatPanel` 的 `ResizeObserver` 回调中，忽略 `0×0` 的瞬时尺寸：

```tsx
const ro = new ResizeObserver((entries) => {
  const cr = entries[0].contentRect;
  if (cr.width === 0 || cr.height === 0) return;
  setPanelSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
});
```

同时移除了之前用于首次读取尺寸的 `useLayoutEffect`，避免 `ResizeObserver` 与一次性读取重复维护同一状态。

## 关键文件

- `app/canvas/page.tsx` — `AgentChatPanel` 的 `panelSize` / `ResizeObserver` 逻辑

## 验证

- `npm run build` 通过。
- 通过 Playwright 检查修复后背景壳 `boundingBox` 保持 `468×762`，`panelSize` 未被异常置为 `0×0`。
- 临时回退修复并重新运行关闭/打开流程，可复现 `ResizeObserver` 产生 `0×0` 回调并覆盖 `panelSize` 的异常；重新应用修复后，背景壳尺寸稳定。

## 备注

- 仅忽略 `0×0` 这种无意义尺寸，不影响正常缩放/窗口调整时的尺寸更新。
- 若后续面板支持可拖拽改变宽度，可保留同一 `ResizeObserver` 逻辑。
