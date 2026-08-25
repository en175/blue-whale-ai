# 资产详情弹窗设计（2026-08-24）

## 目标与范围

资产库页面（`/assets`）的卡片可打开详情弹窗，使用列表已加载到内存中的资产数据渲染，不额外请求详情接口。

本方案仅覆盖资产库页面的详情展示，不扩展画布、共享资产或其他页面入口。

## 交互

- 点击资产卡片，或通过键盘 `Enter` / 空格键，设置 `previewTarget` 并打开弹窗。
- 删除按钮继续调用 `stopPropagation()`，不会触发详情弹窗。
- 点击通用 `Modal` 的关闭按钮或遮罩时，调用 `onClose` 清空 `previewTarget`。

## 组件结构

```
Assets/index.tsx
  └─ AssetDetailModal
       ├─ Modal（通用弹框，宽度 960px）
       ├─ 左侧预览区 AssetPreview
       │    ├─ 图片：Skeleton + img
       │    ├─ 视频：Skeleton + video controls
       │    └─ 音频：图标 + Skeleton + audio controls
       └─ 右侧信息区
            ├─ 资产类型标签
            └─ 来源、创建时间、分辨率、大小、生成模型
```

组件位于 `web/src/pages/Assets/components/AssetDetailModal/`，不使用 `web/src/components/AssetDetailModal` 或共享 `AssetMedia` 组件。

## 布局与响应式

- 桌面端为双栏网格：左侧媒体预览、右侧详情信息；预览区最小高度 480px。
- 预览媒体以 `object-fit: contain` 完整展示，黑色预览背景避免裁切。
- 窄屏（小于 760px）切为单列，详情区移动到预览区下方。
- 媒体加载前显示 `Skeleton`；加载成功或失败后取消加载态。无 URL 时展示“媒体文件不可用”。

## 字段展示与降级

| 字段 | 当前展示规则 |
| --- | --- |
| 类型 | 图片 / 视频 / 音频 |
| 来源 | `uploaded` 显示“用户上传”；`generated` 显示“AI 生成”；其他值原样显示 |
| 创建时间 | 用 `dayjs` 格式化为 `YYYY-MM-DD HH:mm:ss` |
| 分辨率 | 宽高齐全时显示 `宽 × 高`；否则“暂无数据” |
| 大小 | 使用 `formatFileSize`；未返回时“暂无数据” |
| 生成模型 | 使用 `asset.model`；未返回时“暂无数据” |

当前 `AssetRecord` 使用已有字段 `size?` 与 `model`；前端不要求 `generation_job_id`、`project_id`、`mime` 等额外字段。

## 非目标

- 不展示原始 JSON。
- 不增加详情接口、路由或新依赖。
- 不抽离共享媒体组件。
- 不改变资产列表原有的媒体加载与播放逻辑。
