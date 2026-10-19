# IKNCL3 本地副本另存 API v1

状态：实施契约，依赖 IKNCL3 独立合入 release 后由 IKNCL6 接入。来源规格为 IKNCJE-SPEC-20261019 v1。

## 身份与请求

`PUT /api/canvases/:sourceProjectId/local-recoveries/:operationId` 创建或继续一次恢复；`GET` 同路径查询。来源项目必须属于当前账号。operationId 为调用方生成并持久保留的 UUID；同一次恢复必须复用身份和完整原始请求，禁止自动换身份重建。

请求为 `{ name, viewport, nodes, edges }`。name 是 1 至 128 字符；其余三个字段沿用画布 API 的 JSON 字符串。nodes、edges 必须是数组，viewport 必须是对象。调用方先建立目标节点身份并重映射所有内部引用，禁止沿用 generation-output、storyboard-frame 等任务派生身份。请求按 JSON 内容规范化后计算摘要，同身份更改名称或内容会返回 409；不同来源项目属于独立作用域，不同账号看不到原账号结果。

素材必须是当前账号拥有、normal 且未删除的 assets。支持同账号跨项目引用，保存前及查询完成时重新检查；采用既有 project_asset 关联。临时 blob/data 地址必须由调用方先上传并替换。缺失、失效、身份或 URL 不一致返回 422、`reason=local_recovery_assets_unavailable` 和请求内缺项路径，不返回他人素材详情。

角色库参考沿用材料模块认可的 `asset-*` 身份，服务端通过当前账号的 `assets.material_id` 解析对应资产，同时要求 `material_assets` 属于同一账号且状态为 `Active`。资产仍须 normal、未删除，引用 URL 与媒体类型须匹配。未知身份、状态行缺失、Processing/Failed、任一侧撤权、删除或映射移除均返回 422 缺项。不会去前缀猜测数字 ID，也不会用合法 URL 代替材料身份授权。

节点内角色库身份原样保存，不改变请求摘要。耐久回执额外记录解析到的数字资产，GET 与重复 PUT 逐次复核材料状态、账号归属和原资产映射；即使另一个合法资产使用相同 URL，映射替换后也不能沿用旧回执报告完成。首次保存仍通过原事务按数字资产建立目标关联；保存中断后的续作同样按回执身份建立关联，不重新按 URL 认领。

仅含 `src` 的媒体、`srcH264` 备用视频和 `voice.src` 音色同样在首次解析时把命中的数字资产写入耐久回执，后续按该身份复核；同 URL 的其他资产不能替代，原资产仍合法时也不因新增同 URL 资产误报缺项。缺少该身份的旧回执只在本回复项目的素材关联能唯一证明原资产时继续核验，无法证明时返回 422 并保留原回执与目标，不按当前 URL 补认、不换身份重建。

素材提取覆盖持久节点内的 `assetId` / `asset_id` / `assetID` 与 `src` / `url`，包括商品图库、参考图库、音色、文本媒体索引及混合媒体绑定。相同对象的这组三种素材身份、两种主地址别名必须一致。`srcH264` 是独立的视频备用引用，按自己的 URL 授权，可与主视频属于不同合法资产；不以扩展名识别素材，资产登记 URL 中的查询参数原样保留。

工具的 `sourceAssetId`、`lastInput` / `lastParams` 中的 `source_asset_id`，以及图片擦除的 `mask_asset_id`，分别作为独立素材校验。覆盖图片增强、扩图、裁切、抠图、擦除，视频增强、音视频分离、场景切分、智能抠像、去字幕，音频裁切、变速、人声分离及音视频合成；合成配置内绑定视频的 `assetId` / `src` 同样校验。来源和遮罩不能借结果素材通过校验，也不要求与结果素材身份相同。所有通过的资产去重后建立目标关联，并在恢复操作回读时逐项重查。任一项失效都返回 422 缺项，不保存部分目标或返回 complete。正文 `text` / `html` 中的普通链接属于编辑内容，不提取为媒体引用。

恢复请求只能包含独立内容或未提交草稿。jobId、submissionId、generationRecovery、frameInterpolation 等可执行字段及进行中状态会被拒绝。任务来源说明可放在 `localRecoveryProvenance: { sourceProjectId, sourceNodeId, sourceJobId? }`；该对象只承载来源说明，不进入旧任务执行字段。预览来源 promptSource 及其受保护绑定不能直接跨项目冒充；调用方须转换为普通文本与合法 mediaMentions/mediaRefs，保留正文、索引和来源说明。服务端不会静默删字段或猜补配置。

## 阶段与结果

成功信封沿用 `{ code: 200, msg: null, data }`。data 包含 operationId、sourceProjectId、targetProjectId、stage（created / complete）、version。created 仅表示目标已创建，不能显示恢复完成。complete 仅在内容保存并重新读取一致后返回。

服务端复用 command_idempotency，操作类型 LOCAL_CANVAS_RECOVERY_V1，作用域为来源项目和 operationId。事务内创建目标项目与耐久映射，不存画布全文。事务失败不会遗留未映射项目；并发请求在来源项目行锁后回读同一映射，无进程内锁或无限重试。目标创建后保存失败仍保留映射，GET 能查到 created，再次 PUT 继续同一目标。

创建事务锁定当前账号的来源项目行，再回读或创建映射；同一来源的并发创建依次确认同一目标。记录无 TTL，查询不按创建时间失效。现有 schema 未定义过期字段，backend、server、scripts 的非测试实现未发现删除这些记录的清理器，项目删除仅软删项目与直接素材；不得把本操作纳入后续通用幂等缓存清理。原项目或目标被删除、转移后拒绝访问，保留原映射，不自动创建替代目标。

目标首次保存复用 CanvasService.save，固定 expectedVersion=null。重复 PUT 不采用目标新版本覆盖；首次保存回执丢失时，GET/PUT 以记录的文档摘要核对实际持久内容，确认后返回 complete。目标已有其他内容则返回 409、`reason=local_recovery_target_changed`，保留副本和目标。已完成操作再次请求只查询结果，不重写目标。

404 表示来源、目标或操作不存在/无权访问；409 表示身份内容不一致或目标被修改；422 表示缺素材或旧执行身份；400 表示请求结构无效。普通保存原有 409/412/422/428 语义保持。所有失败均保留调用方本地副本；只有 complete 后用户确认不再需要才允许清理。

受控错误由恢复控制器显式发送 HTTP 状态与完整信封，保留 data.reason 和 missing；未知异常仍交由既有全局过滤器处理。公开 API 测试挂载生产 AllExceptionsFilter，验证实际错误信封。

## 持久化与验收

无需新增表或 DDL。每次访问核验来源项目、目标项目及素材权限。原画布、原任务和计费链路不修改。公开 HTTP API 验证使用新建一次性本地 MySQL；不得把 mock 或条件跳过计为真实验收。

本次授权边界沿用 asset-repo 的本人素材读取与 linkAssetToProject：都校验 user_id。shared_assets 也是按账号保存与读取的快照，不构成任意他人素材授权。仅有关联记录不能替代素材归属、normal 状态和未删除检查。媒体引用在 CanvasService.save 的原子保存事务中复用 linkPromptMaterials 建立 project_asset 关联，并在完成确认时再次核验。来源说明存放于节点 data.localRecoveryProvenance，现有 serializeNodes 会透传该字段，后端保存与 snapshot 重读保留该对象。

后续调用方须同时验证该字段经过真实卡片 hydration、serializer 及页面刷新仍可用。当前后端交付不代表前端恢复入口、人工页面回归或部署后验收完成。
