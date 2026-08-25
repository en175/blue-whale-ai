# 资产点击详情弹窗 — 设计（2026-08-24）

- 范围：web.master.xfai.cloud（测试站 Web v1.0.1）资产库页面资产卡片点击 → 详情弹窗
- 目标：点击资产卡片弹出详情，展示该资产数据的可读信息（媒体预览 + 字段），后端补字段作为数据底座

## 1. 背景与需求

资产库页面（`blue-whale-ai/web/src/pages/Assets/index.tsx`）当前资产卡片**点击无任何行为**（仅右上角删除按钮，且 `stopPropagation`）。需求：给资产数据加点击详情弹窗，弹窗携带该资产数据的各种来源信息（近似一个 JSON 的数据结构）。

需求确认结论：

| 项 | 结论 |
| --- | --- |
| 入口 | 仅资产库页面（`/assets`）资产卡片点击 |
| 弹窗内容 | 该资产数据的完整字段（JSON 是弹窗背后的数据携带结构） |
| 展示形态 | 媒体预览 + 可读字段，**不给用户看原始 JSON** |
| 可读字段 | 类型 / 来源 / 尺寸 / 时长 / 创建时间 / 文件大小 |
| 后端 | 方案 A：扩展列表接口返回字段（含 generation_job_id 等溯源信息作为数据底座） |

## 2. 现状数据模型

前端 `AssetRecord`（`web/src/api/assets.ts`）当前 8 字段：
`id / type / url / width / height / duration / source / created_at`

后端 `assets` 表（`packages/persistence/prisma/schema.prisma`）实际字段更多，但列表接口只返回上述 8 个：
`user_id / project_id / generation_job_id / storage_key / content_sha256 / mime / size / status / version / is_delete` 等未返回。

`source` 取值：`uploaded`（用户上传）、`generated`（AI 生成产物，关联 `generation_job_id` 可溯源到生成任务）。

## 3. 架构

```
点击资产卡片
   │
   ▼
Assets/index.tsx  setDetailTarget(asset)   ← 内存数据，零额外请求
   │
   ▼
AssetDetailModal（新组件）
   ├── 媒体预览区（图片/视频可播放/音频带控件）
   └── 可读字段区（类型/来源/尺寸/时长/创建时间/文件大小）
   │
   ▼
数据底座 = 后端列表接口扩展字段（size + generation_job_id 等）
```

无新接口、无新依赖、无路由改动。

## 4. 前端改动

### 4.1 新组件 `web/src/components/AssetDetailModal/index.tsx` + `index.module.css`

- Props：`asset: AssetRecord | null`、`onClose: () => void`；`asset` 为 null 时不渲染。
- 模式对齐现有 `ConfirmModal`：遮罩点击 / ✕ 关闭，带 `role="dialog"` + `aria-modal="true"`（与 AgentPanel 的 ESC 守卫 `closest('[role="dialog"], [aria-modal="true"]')` 兼容）。
- 顶部媒体预览：图片 `<img>`、视频可点击播放（`<video controls>`）、音频 `<audio controls>`；复用 Assets 页 `AssetMedia` 的 loading/loaded/error 三态思路。
- 字段区（可读中文展示，无原始 JSON）：
  - 类型：图片 / 视频 / 音频
  - 来源：`uploaded` → 用户上传；`generated` → AI 生成；其他/空 → 未知来源
  - 尺寸：`宽 × 高` px（图片/视频，音频显示 —）
  - 时长：格式化 `mm:ss`（视频/音频，图片显示 —）
  - 创建时间：`created_at` 本地化（`toLocaleString`）
  - 文件大小：`size` → KB/MB 格式化；null 显示 —

### 4.2 修改 `web/src/pages/Assets/index.tsx`

- 新增 `const [detailTarget, setDetailTarget] = useState<AssetRecord | null>(null)`。
- 卡片 `div` 加 `onClick={() => setDetailTarget(asset)}`（右上删除按钮已有 `stopPropagation`，不冲突）。
- 页面底部渲染 `<AssetDetailModal asset={detailTarget} onClose={() => setDetailTarget(null)} />`。

### 4.3 修改 `web/src/api/assets.ts`

`AssetRecord` 扩展：
```ts
size: number | null;              // 文件大小字节（后端新增返回）
generation_job_id: string | null; // AI 生成溯源（数据底座）
project_id: string | null;        // 所属项目（数据底座）
mime: string | null;              // MIME（数据底座）
```

## 5. 后端改动

### 5.1 修改 `packages/persistence/src/asset-repo.ts`

- `AssetView` 接口增加 `size`、`generation_job_id`、`project_id`、`mime` 字段。
- `listByUser` 的 records map 补充上述字段：
  - `size`：BigInt → `Number(a.size)`（文件上限 200MB，远低于 `Number.MAX_SAFE_INTEGER`，number 安全）。
  - `generation_job_id` / `project_id`：BigInt → `String(...)`；null 透传。
  - `mime`：字符串直传。
- `backend/apps/blue-whale/src/api/assets/assets.controller.ts` 无需改动（`ok()` 直通）。

### 5.2 待核实点

- repo 注释（`asset-repo.ts`）提到部署表 assets 可能缺 `content_sha256 / source_asset_id / generation_job_id` 列。实现前核实部署库 assets 表结构；缺列则该字段恒为 null，不影响主功能（显示必需字段只有 `size`，部署表必有）。
- 若部署库表结构未知，`generation_job_id` 等字段按 Prisma schema 查询，缺失列会在查询时报错 —— 需在实现时以实际部署库为准裁剪字段或先确认列。

## 6. 错误处理

- `size` / 其他字段为 null → 对应行显示「—」。
- 媒体加载失败 → 复用现有 error 三态 + 重试按钮。
- 未知来源值 → 显示原始值而非空白。

## 7. 测试

- 前端 vitest：来源映射 / 时长格式化 / 文件大小格式化单测；AssetDetailModal 打开/关闭冒烟。
- 后端：`packages/persistence/src/asset-repo.test.ts` 补 `listByUser` 新字段断言。
- 手测：dev 起前端连测试站后端（`npm run dev:test`），资产库点卡片验证弹窗展示与字段正确性。

## 8. 明确不做（YAGNI）

- 不给用户展示原始 JSON（用户明确要求"不要展示 json，给用户看的东西"）。
- 不做共享资产弹框 / 画布节点的详情入口（本次仅资产库页面）。
- 不新增详情接口（方案 A：扩展列表接口，零额外请求）。
- 不做来源筛选 / 编辑 / 下载等附加操作。
