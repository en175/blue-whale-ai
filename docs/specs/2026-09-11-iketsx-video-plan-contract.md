# 视频方案引用与冻结输入契约（IKETSX）

> **该接口已退役**（IKHQ0C / IKHQ0D，2026-09-22）：本文「引用与校验」一节描述的引用命令 `POST /api/canvases/:projectId/prompt-references` 已于 0915 批次退役（提交 `7a3f05c0`，2026-09-18，IKG99G）——前端改为纯本地建「方案 → 草稿」方案边、把绑定写在边上的 `promptReference`，后端路由与实现随之删除。**本文档保留为当时的决策记录**；引用边数据形状、`videoReferences` 顺序与首尾帧角色约束，以及「快照扩展」一节的冻结输入契约仍然有效。

## 时间

2026-09-11

## 背景与范围

基于已确认的 release/2026.09.15（1e966847），扩展 IKETSW 的同一引用命令、promptReference 和 inputSources；不修改其他目标的确认集合。方案用途与标题不决定实际生成类型，目标类型决定模型能力校验。

## 引用与校验

引用命令仍为 `POST /api/canvases/:projectId/prompt-references`，视频目标根据已保存的 draftModelId、draftMode 校验。模式不自动切换。普通参考允许当前模型支持的图片、视频、音频；首尾帧只允许图片。方案、素材各有目标直接入边，来源按 assetId 去重，已有角色保留，新增媒体默认 reference。方案正文和草稿不复制、不覆盖。

接纳复核当前正文、绑定确认集合、全部直接媒体边与有序 references（asset_id 或 material_id，外加 type/role）。未提供 references 的纯文字仍可用；带素材的方案必须通过该统一数组提交，防止旧字段丢失顺序或类型。模型/模式不支持、超限、缺失、越权、非法标签或视频格式失败均拒绝整次提交并指出方案索引。

## 快照扩展

沿用 `input.prompt_plan_snapshot`。图片任务字段不变。视频任务保留 `canvasVersion`、`plans`、`providerPrompt`，`images=[]`，新增 `videoReferences: [{assetId?,materialId?,type,role,url,providerUrl}]`（assetId/materialId 二选一）。type 为 image/video/audio，role 为 reference/first_frame/last_frame；url 是接纳时真实资产 URL，providerUrl 为冻结的 URL 或已关联素材库的 asset:// ID。已有手动素材库输入从目标已保存 draftMaterialRefs 核对身份、类型和角色，保留 asset:// 身份；素材库的权限与物理参数仍沿既有上游校验，本地资产继续校验归属。顺序等于当次 references；同一供应商身份重复而可能歧义时拒绝。

正文 mention 按最终同类型普通参考顺序转换为 `参考图N`、`参考视频N`、`参考音频N`；首尾帧转换为 `首帧`、`尾帧`。原文、assetId 与 UTF-16 区间仍保留在 plans。事务锁定画布版本并复核资产归属、类型、URL 与关联素材身份；失败不创建有效任务。

TS 与 Java 视频执行器直接消费冻结正文及媒体，不重新解析资产；模型、尺寸、时长沿用既有 input。重试保留既有快照，后续编辑或断线不改变已接纳输入。无此字段的历史任务沿既有路径。

## 验证

真实浏览器 → 公开业务 API → 隔离本地 MySQL；仅外部 Agent/供应商替换为记录式服务。核对视频成功、跨类型、模式/类型限制、历史输入稳定以及图片回归。
