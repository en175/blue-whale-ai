# 033-context — 画布底部图像 Dock 新增模型/质量/宽高比弹窗

## 需求背景
画布底部图像输入 Dock（`ImageDockContent`）之前硬编码了一行设置信息：

```
GPT Image 2 · 1:1 · 1K
```

这行信息只是静态展示，用户无法点击修改模型、质量或宽高比。参考设计稿，需要把这一行做成可点击 Pill，点击后从 Pill 上方弹出一个固定定位（`position: fixed`）的弹窗，包含：

1. **模型与质量**：模型下拉框 + 分辨率（质量）下拉框。
2. **宽高比**：一排 13 个比例按钮（9:16、3:4、1:1、4:3、16:9、2:3、3:2、5:4、4:5、21:9、9:21、1:2、2:1）。

## 实现方案

### 1. 共享图标组件 `AspectRatioIcon`
13 种宽高比的图标都是自定义 SVG 矩形，不同比例的矩形坐标需要精确。为了避免在多处重复维护这些坐标，新建了共享组件：

- `components/icons/AspectRatioIcon.tsx`
- 根据 `ratio` 返回对应 `viewBox="0 0 16 16"` 的矩形。
- 支持 `filled` 和 `width/height`  props，供选中态和非选中态复用。

原 `AgentComposer.tsx` 里也有类似的占位图标函数，已替换为共享组件，保证图标一致。

### 2. 独立弹窗组件 `ImageModelSettingsPopover`
把弹窗逻辑独立到新文件，减少对大文件 `app/canvas/page.tsx` 的侵入：

- `components/ImageModelSettingsPopover.tsx`
- 导出常量：
  - `IMAGE_MODELS`（含 GPT Image 2、Nano Banana 2、Nano Banana Pro、Seedream 5.0）
  - `IMAGE_RESOLUTIONS`（1K / 2K / 4K）
  - `IMAGE_ASPECT_RATIOS`（13 种比例）
- 通过 `triggerRef` 计算 Pill 的 `getBoundingClientRect()`，将弹窗 `position: fixed` 定位在 Pill 上方（`bottom = window.innerHeight - rect.top + 8`）。
- 内部实现了两个下拉菜单和 13 个比例按钮。
- 点击弹窗外部或再次点击 Pill 可关闭弹窗。

### 3. 接入 `ImageDockContent`
在 `app/canvas/page.tsx` 的 `ImageDockContent` 中：

- 新增状态：`selectedModel`、`selectedResolution`、`selectedAspectRatio`、`modelSettingsOpen`。
- 为设置 Pill 增加 `ref` 和 `onClick`，点击切换弹窗显隐。
- Pill 内文字改为响应式：`selectedModel.label`、`selectedAspectRatio.label`、`selectedResolution.label`。
- 渲染 `<ImageModelSettingsPopover />` 并传入对应状态和回调。

## 关键文件

- `components/icons/AspectRatioIcon.tsx`：共享宽高比图标。
- `components/ImageModelSettingsPopover.tsx`：弹窗组件、常量、内部下拉菜单。
- `app/canvas/page.tsx`：接入弹窗的 `ImageDockContent`。
- `components/AgentComposer.tsx`：改用共享 `AspectRatioIcon`。

## 验证

1. 构建通过：

   ```bash
   npm run build
   ```

2. 启动生产服务并临时编写 Playwright 脚本验证：
   - 打开 `/canvas`。
   - 点击左侧「AI 图片」按钮打开图像 Dock。
   - 点击设置 Pill（`aria-label="图像模型设置"`）弹出固定弹窗。
   - 点击「16:9」宽高比，确认 Pill 中的比例文字同步变为 `16:9`。
   - 点击页面空白处，弹窗关闭。

   验证结果：`Popover interaction verified.`

## 备注

- 弹窗使用 `position: fixed` + `z-index: 2147483605` 定位，确保层级足够高。
- 由于 `ImageDockContent` 位于 `BottomDock` 的 `clipPath` 容器内，若弹窗作为组件子树直接渲染，会被父级裁剪导致「点击有效果但看不到弹窗」。因此使用 `createPortal` 将弹窗挂载到 `document.body`，同时保持 `position: fixed` 定位不变。
- 弹窗内的模型、分辨率下拉菜单目前用 React 状态就地展开。
- 图标里的 13 组矩形坐标是基于参考设计稿直接算出的，保持视觉比例准确。
