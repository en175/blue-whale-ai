# 上游素材库纯过境对接：零本地表、透传镜像、只格式校验

- **状态**：Accepted
- **日期**：2026-08-26
- **决策者**：项目团队（经 `grill-with-docs` 会话确认）
- **关联工单**：`--no-issue`（后补需求/任务工单）
- **上游**：网关 blue-whale-api（new-api 二开）的「素材模块对外 API 接口文档」（`/api/material/{Action}`），对接 ai-tokenhub 素材库（火山 ARK 兼容接口）
- **上游决策**：网关仓 `docs/adr/0005-material-library-transparent-proxy.md`、`docs/adr/0007-material-library-provider-and-unified-format.md`

## 背景

AI 产品（Canvas 创作）需要素材库能力：管理（素材组/素材/真人活体认证）+ 视频生成用
`asset://<素材ID>` 引用素材。素材库已由网关（blue-whale-api）对外暴露
`POST /api/material/{Action}`（TokenAuth `sk-` key），透明代理 ai-tokenhub（火山 ARK 兼容）。
本仓只对接、不改上游、只动后端（`backend/` + `packages/`），不动前端。

真人素材是核心动机：Seedance 2.0 拒绝任意直传真人人脸，官方唯一合规输入路径即「授权录入
真人形象素材」→ `asset://` ID（见
[研究文档](2026-08-04-seedance-realface-verification.md)与[参考素材契约](2026-07-29-seedance-video-reference-inputs.md)）。

## 决策

1. **零本地表，纯过境**：素材库素材的归属（网关 `user_material_groups`）与状态（Active/
   Processing/Failed）全部以网关/上游为权威，**本地不建任何素材库表、不镜像状态**（网关术语表
   原文「状态以上游为准，本地不镜像」）。本地唯一持久化点 = `generation_jobs.input` 冻结的
   素材引用快照（那是生成任务自己的输入，不是素材镜像）。
2. **透传镜像 API**：产品侧同形暴露 `POST /api/material/{Action}`，PascalCase 请求体、上游
   信封（`ResponseMetadata/Result`、`ResponseError`、真人会话直接格式）与非 2xx 状态码**原样
   回传**，不增翻译层；产品鉴权 = 登录会话（AuthGuard 回注的 `Bearer sk-`），会话内换成用户
   密封上游执行凭证打网关。白名单固定 12 个 Action（组 4 + ListAssetGroups + 素材 5 + 真人会话
   2），**无 wildcard 透传**；上游未实现的 `GetModerationResult` 不暴露。
3. **真人会话关闭自定义回调**：`CreateVisualValidateSession` 剥离 body 中的 `CallbackURL`，
   认证数据与回调全由网关维护；产品只透传创建用 `Name`/`ProjectName` 与查询轮询。
4. **生成引用只格式校验、不调上游**：新增 `first_frame_material_id` / `last_frame_material_id`
   与 `reference_materials: [{ id, type }]`（仅视频生成）。只做 `Asset-` 前缀格式校验与
   数量/模式规则（与本地 Asset 引用按**并集**互斥、配对、计数）；存在性、状态与物理约束
   （像素/时长/大小）由上游强校验，错误异步翻译。素材类型（image/video）随请求携带——本地
   零落表，无从查得。

## 被否方案

- **本地映射表**（Asset↔素材库 Asset-xxx）：用于联动删除/展示已注册关系。否决：素材库文件
  真身在火山侧，TOS 副本是独立产品资产，各管各生命周期反而干净；映射引入 migration + 双边
  一致性，违背「只对接」基调。
- **落库为 Asset**：违背本仓 Asset「归属 Project + 产品控制对象存储」定义，且素材库按账号
  （sk- 所属）隔离、不归属 Project。否决。
- **创建生成任务时同步调 `GetAsset` 预检**：增加 N 次上游往返，且预检通过≠执行时仍有效
  （上游状态会漂移）。否决，保持纯过境。

## 影响

- 上游素材库素材是**账号维度外部目录**，与项目维度 Asset 是两个不同概念；`asset://` 双义
  （PlanMessage 内部 mention 协议 vs 火山生成载体）互不串用。术语已写入 `CONTEXT.md`。
- 未来网关新增素材 Action 时，产品侧需在 `MATERIAL_ACTIONS` 白名单显式跟进（有意不放
  wildcard）。
- 素材库素材引用 **只接直接创建生成任务入口**，不碰 Agent PlanMessage / AssetMention 路径。
