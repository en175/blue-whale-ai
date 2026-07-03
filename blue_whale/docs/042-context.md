# 042-context — 底部 Dock 缩略素材支持删除（图片+视频）

## 背景
底部图片/视频 Dock 里带入的素材缩略图，此前只能展示不能移除。需支持点击删除，图片和视频 Dock 都要支持。

## 改动（仅 `app/canvas/page.tsx`）

### 1. 新增 DockMediaThumb 组件
抽离缩略图渲染，含右上角圆形删除按钮（X 图标，16×16，半透明黑底+毛玻璃，aria-label=`移除 素材名`）。删除按钮调用 `onRemove(item.id)`。

### 2. ImageDockContent / VideoDockContent
- props 新增 `onRemoveMedia?: (id: string) => void`
- 缩略图渲染改用 `<DockMediaThumb item={m} onRemove={onRemoveMedia} />`（替换原内联 img）

### 3. BottomDock 透传
- props 新增 `onRemoveImageMedia` / `onRemoveVideoMedia`
- 分别透传给图片/视频 Dock

### 4. CanvasPageInner 提供删除回调
```tsx
onRemoveImageMedia={(id) => setImageDockMedia((prev) => prev.filter((m) => m.id !== id))}
onRemoveVideoMedia={(id) => setVideoDockMedia((prev) => prev.filter((m) => m.id !== id))}
```
删完后 media 为空，Dock 自动从缩略图回到原占位按钮（MediaUploadButton / Upload reference image）。

## 不动的部分
- 带入素材的逻辑（操作面板按钮）、其它 Dock 结构、顶部输入框、各浮层等不变。

## 验证
- `npx tsc --noEmit` 通过。
- Playwright（临时脚本，已删除）：
  - 图片 Dock：再创作带入 1 张 → 点删除 → 缩略图消失、占位恢复 ✅
  - 视频 Dock：生成视频带入 1 张 → 点删除 → 缩略图消失 ✅

## 关键文件
- `app/canvas/page.tsx`
