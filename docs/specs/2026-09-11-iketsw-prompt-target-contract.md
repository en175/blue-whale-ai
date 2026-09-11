# 方案引用与生图接纳契约（IKETSW）

## 时间

2026-09-11

## 范围与基线

基于用户指定的本地 release/2026.09.15（dfb5c533），承接 IKETSV。验证边界沿用 IKE5G8 已确认的浏览器、公开业务 API、隔离数据库与记录式外部供应商。

## 引用命令

`POST /api/canvases/:projectId/prompt-references` 接受 `{planNodeId,targetNodeId,expectedVersion,modelId?}`。客户端先保存当前编辑；服务端验证当前版本、可信方案、素材、图片目标与模型能力后原子保存全部连线。modelId 缺省取目标 draftModelId，再取启用的默认图片模型。版本冲突返回 412，不覆盖草稿；重复命令在新版本下幂等。

方案边 `data.promptReference = {bindings:[{index,assetId}]}` 保存该目标已确认的标签身份集合（去重并按 index 排序，不含文字区间）。媒体边 `data.inputSources = {manual:boolean,planNodeIds:string[]}` 记录来源。已有无来源元数据的媒体边视为手动引用；同一资产复用目标已有的直接边，否则按画布顺序选择同 assetId 的现有卡，不按位置或名称判断。普通文本附件行为保持。

引用只修改目标入边，不改节点、正文或模型参数，不触发生成。来源归属与绑定版本供后续 IKETSX/Y/Z 消费；本票不新增同步或移除 UI。已有方案边的确认集合不由重复引用覆盖，素材变化需后续显式同步。

## 接纳与执行

生图接纳从已保存画布读取当前正文与标签，验证已确认绑定、直接媒体边、客户端 input_asset_ids、素材权限与模型能力。索引错误、缺素材、未同步或超限整次拒绝，并指出方案与索引。图像索引按最终输入顺序编译为 `参考图N`；原文与 UTF-16 标签区间单独保留。

方案生图新增 `input.prompt_plan_snapshot = {canvasVersion,plans:[{nodeId,text,mentions}],images:[{assetId,url}],providerPrompt}`。plans 保存原文与标签映射，images 顺序严格等于 input_asset_ids，providerPrompt 是组合目标提示词后的最终供应商正文。字段只由服务端产生，客户端不可传入。创建事务锁定画布版本及引用资产，变化时不建任务；执行端与重试消费冻结正文和图片 URL，不回读后续正文或连线。

Java 与 TypeScript 图片执行入口共同消费该可选快照；无该字段的既有任务保持兼容。模型与尺寸等参数仍使用既有 input 字段。
