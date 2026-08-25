# 资产详情弹窗实施说明（当前实现）

## 实现结论

资产详情弹窗采用页面内组件方案，已接入资产库页面。实现以当前代码为准，不采用 PR !418 的全局详情组件、共享媒体组件或额外前端资产字段。

## 已实现文件

| 文件 | 职责 |
| --- | --- |
| `web/src/pages/Assets/index.tsx` | 保存 `previewTarget`；处理卡片点击与键盘打开；渲染并关闭详情弹窗 |
| `web/src/pages/Assets/components/AssetDetailModal/index.tsx` | 基于通用 `Modal` 的详情内容与媒体预览 |
| `web/src/pages/Assets/components/AssetDetailModal/index.module.css` | 双栏布局、预览区、信息栏与移动端单列样式 |
| `web/src/pages/Assets/components/AssetDetailModal/format.ts` | 来源、创建时间和分辨率格式化 |
| `web/src/utils/format-file-size.ts` | 文件大小格式化 |
| `web/src/components/Modal/` | 通用弹框能力 |
| `web/src/components/Skeleton/` | 媒体加载占位 |

## 行为清单

- [x] 卡片点击打开资产详情。
- [x] Enter / 空格键可打开资产详情。
- [x] 删除按钮不触发详情弹窗。
- [x] 图片、视频、音频分别使用适配的预览控件。
- [x] 媒体加载时显示骨架屏。
- [x] 展示来源、创建时间、分辨率、大小、生成模型。
- [x] 缺失字段统一显示“暂无数据”。
- [x] 小屏幕切换为预览在上、详情在下的单列布局。

## 约束

- 弹窗只消费资产列表接口已有的 `AssetRecord` 数据，不发起额外详情请求。
- `size` 允许缺失；`model` 为空时仅显示降级文案。
- 后端持久化层可独立扩展资产数据，但 Web 端不因详情弹窗新增 `generation_job_id`、`project_id` 或 `mime` 依赖。

## 验证建议

1. 在资产库分别打开图片、视频和音频卡片，确认预览和字段渲染正确。
2. 验证删除按钮只出现确认删除弹窗。
3. 用键盘 Enter 与空格键验证详情弹窗可访问性。
4. 在窄屏宽度下确认双栏布局切换为单列。
5. 运行 Web 类型检查与相关组件测试。
