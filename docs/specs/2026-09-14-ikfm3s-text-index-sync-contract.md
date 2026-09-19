# 文本索引下游同步契约 v1（IKFM3S）

> ⚠️ **部分已由 [ADR-0088](../adr/0088-prompt-assembly-ownership-and-reference-marker.md) 取代**：
> 本契约中一切以 `prompt_doc` 为权威编译源、以及 `composed_prompt` / `providerPrompt` 冻结的条款
> 已作废——正文一律取提交方的 `parameters.prompt`，服务端只做引用标记转移（`&<身份>&` → `@标签`）。
> 引用来源模型与文本索引派生部分继续有效。

日期：2026-09-14
状态：定稿（跨层实现前的版本化契约）。
来源：IKFLZT 统一画布文本节点规格用户故事 21–40 与实现决策 3/4/5；基线为《文本卡正文媒体索引契约 v1》（IKFM3Q，下称索引契约）与《生图正文素材标签（prompt_doc）契约》（IKFA1M）。前后端与 Worker 以此为准，不得各自发明字段。任务 4（视频）/ 任务 5（音频）复用本契约字段与接缝，不重新定义。

## 1. 引用来源模型（派生，无新增持久化来源集合）

- 图片生成目标（`type=image` 且携带 `target_node_id`）的实际参考 = **直接参考 ∪ 文本带入参考**：
  - 直接参考：媒体节点 → 目标连线（IKDMQR 连线模型，不变）；
  - 文本带入参考：文本卡 → 目标连线上，该文本卡**有效** `mediaMentions` 身份按 (nodeId → assetId) 解析出的素材。
- 身份与有效性判定同索引契约 §1/§3：身份 = (nodeId, assetId)；有效 ⟺ 来源节点在画布、`textIndex` 关系线存在、素材真实可及。失效身份不进入参考，但触发 §4 发送阻止。
- **文本带入参考不产生画布连线**（媒体 → 目标不自动建线）；来源保留纯派生：素材去留 = 其来源集合非空。删除标签/断关系线/断开文本 → 目标连线只解除对应来源，其他来源（其他文本卡、直接参考）仍在则素材保留。
- 目标参考栏显示 = 提交输入（同一推导，「显示输入 = 实际任务输入」原则，mediaRefs.ts 头注同源）。

## 2. 参考并入规则（前后端同源函数，契约包唯一实现）

- 合并顺序：直接参考在前（按画布连入边序 / 提交 `input_asset_ids` 序），文本带入参考追加在后，按（文本入边边序 × 该卡正文首现身份序）展开。
- 同 `assetId` 去重保首见（直接参考已含的素材不重复进入，编号复用）。
- **后端权威并入（并集语义）**：`handleCreateGenerationJob` 在参考语义统一后，按最新画布重推导文本带入素材集合，将 `body.input_asset_ids` 缺失的项按推导序追加尾部；新客户端前端同源预演合并后提交，常态下后端零追加、序不变。旧客户端画布无 `mediaMentions` → 派生集为空，行为不变。
- 容量校验在合并后执行：总数 > `max_reference_images` → `400`（文案沿用「参考图最多 N 张」，`unsupported_input`）。
- 超限/类型/失效均为**阻止发送**语义：不静默丢弃不兼容素材后宣称同步完成。

## 3. 能力校验（客户端与业务 API 一致，不能仅靠按钮禁用）

提交 `type=image` + `target_node_id` 时，后端按最新画布执行，前端提交前按同一契约函数执行同口径校验：

| 场景 | 后端响应 | 前端行为 |
| --- | --- | --- |
| 任一连线文本卡存在失效 `mediaMentions` 身份 | `400 invalid_reference`「文本索引存在失效素材，请修复来源文本后提交」 | 禁止发送并显示原因；保留文本编辑 |
| 文本带入素材含非图片媒体类型 | `400 invalid_reference_type`「文本索引包含目标不支持的媒体类型，请修改来源文本」 | 同上 |
| 合并后参考数超 `max_reference_images` | `400 unsupported_input`（§2 文案） | 同上 |
| 文本带入素材不存在/无权访问 | `400 invalid_reference`「参考素材不存在或无权访问」（既有复核同码） | — |

- 校验按目标独立执行：同一文本连接多个目标时，不兼容目标分别提示阻止，兼容目标正常同步与发送。
- 文本带入素材并入后与直接参考同走 `resolveInputAssets` 存在性/归属复核。

## 4. 输入签名与「输入已更新」提示

- **文本输入签名** `textInputSignature`：对目标全部文本入边（按边序）的规范化数据哈希——每边 `{ nodeId, text, identities: [(nodeId, assetId, mediaType) 按正文首现序] }`（仅**有效**身份）。直接参考变化不入签名。函数放契约包，前后端同源。
- 提示判定（派生，不保存可过期布尔）：目标存在文本入边 **且** 当前签名 ≠ 节点 `data.usedInputSignature` → 目标卡右上角显示显眼「输入已更新」徽标；刷新后恢复。
- 持久化与清除：
  - 提交时后端计算签名冻结进 `job.input.text_input_signature`（string）；
  - 任务**成功**时前端轮询回调（含水合恢复轮询）把签名回写目标节点 `data.usedInputSignature`，随画布自动保存落盘；失败/取消不回写；
  - **乱序保护**：同时回写 `data.usedInputJobId`（number，任务 id 单调递增）；仅当本次 jobId > 已存值才覆盖——旧任务成功不清除更晚编辑的提示；
  - 响应通道：`JobRecord.input`（列表，既有脱敏投影）与 `JobDetail.text_input_signature`（详情，顶层单字段投影——`input` 含 provider_credential 不整包下发）回传。
- 签名字段是系统 UX 状态：画布保存校验宽松放行（形态校验：`usedInputSignature` string ≤128、`usedInputJobId` 正整数），不做防伪——伪造仅影响本画布提示显示，无越权收益。
- 同步只更新下一次生成输入：不自动触发生成、不修改运行中任务与已有结果。

## 5. 生成冻结与重试

- `job.input.input_asset_ids` = §2 合并去重后的最终序（冻结；`prompt_doc` 标签编号按该序派生，前端拍平镜像同源）。
- `job.input.text_attachments` 每项扩展冻结当时有效身份映射：`media: Array<{ node_id, asset_id, media_type }>`（node_id = 素材来源画布节点 id，与索引契约身份同源；缺省 = 无有效媒体，兼容旧快照）。
- `text_attachments[].text` 在接纳时按最终参考列表编译：仅替换 `mediaMentions` 中绑定 `(nodeId, assetId)` 的区间，图片按最终素材序，视频/音频按最终 references 同类型序编号。普通文字及 Markdown 保持原样；不同文本卡的局部编号独立映射。`prompt_doc` 编译与方案快照使用同一最终参考列表。
- 重试沿用既有「原样复制 input」语义，编译后的正文、签名与媒体映射随快照冻结；签名仍取原始画布正文，重试成功同样触发 §4 回写。

## 6. 参考栏交互（图片面板）

- 文本带入条目带可见锁定标记（橙色虚线描边 +「来自文本」悬停说明），不渲染移除入口（比点击后 toast 拦截更强的防呆）；定位按钮 title 携带「此素材由文本索引提供，请修改来源文本」，点击定位来源文本卡（画布平移定位 + 短暂高亮，同索引契约 §5 形态）。
- 同素材多来源显示单条目；存在直接来源时可移除直接来源（断连线），剩余来源决定条目去留与锁定态。
- 编号（图片N）由合并后最终序派生；文本卡显示编号与目标参考顺序不同，不把显示编号当目标素材序号（索引契约 §2）。

## 7. 画布保存校验（canvas.service.ts save）

- `textNode` 的 `mediaMentions`/`mediaRefs` 校验不变（索引契约 §7）。
- `mediaNode.data` 允许出现 `usedInputSignature` / `usedInputJobId`（§4 形态校验）；不引入其他新字段。

## 8. 测试接缝

- 契约单测（backend/libs/contracts）：合并去重与顺序、签名稳定性（正文变/身份变/直接参考不变）、校验函数错误分类。
- 后端集成（隔离 MySQL，`IKFM3S_DATABASE_URL` 门控，沿用 text-node-media-index 模式）：并入/去重/超限/失效阻止/类型阻止/素材复核、快照冻结（input_asset_ids、text_attachments[].media、text_input_signature）、重试复用。
- 浏览器 e2e（Playwright + 动态画布夹具，沿用 text-node 布局模式）：多文本共享与直接参考共存、删标签/断线只解除对应来源、锁定移除拦截与定位、右上角提示显示/刷新恢复/成功清除/失败保留/旧任务竞态、提交与重试真实输入核对；截图核对右上角提示。
- 受控供应商仅用于生成契约验证；不声称真实模型效果、真实 MQ 或部署验收。

## 9. 版本演进边界

- 任务 4/5 在本契约字段上扩展目标类型与角色语义，不重定义来源模型、签名与冻结字段。
- worker 只消费冻结快照，本契约不改变其输入形态，零适配。
- 不引入文本卡附件列表、文本互引、自动生成或改写运行中任务/已有结果。

## 10. 视频目标扩展（IKFM3W，v1.1）

v1.1（2026-09-15）按 §9 授权扩展视频生成目标；§1–§8 全部沿用（同一派生/签名/冻结实现），本节只新增目标类型与角色语义。

- **适用范围**：`type=video` 且携带 `target_node_id`。引用来源模型（直接参考 ∪ 文本带入参考，纯派生）与 §1 完全一致。
- **角色语义**：文本带入参考一律为普通参考（`role=reference`），不推断首帧/尾帧角色、不进入帧槽；同 assetId 去重保首见（`material_id` 空间不参与去重——文本带入只有本地画布素材）。
- **接受的媒体类型按目标模型能力位**：`image` 恒接受；`video` 需 `features.video_reference`；`audio` 需 `features.audio_reference`。不接受类型 → `400 invalid_reference_type`（文案沿用 §3「文本索引包含目标不支持的媒体类型」）。
- **首尾帧互斥**：目标已有帧角色（references 含 `first_frame`/`last_frame`，或携带旧帧字段）且文本带入参考非空 → `400 invalid_reference`「首尾帧模式不能与文本带入参考混用，请调整参考或修改来源文本」；不静默丢素材、不把帧素材降级为普通参考。
- **并入规则**：直接参考（references 单数组保序）在前，文本带入按派生序追加尾部为 `{ role: "reference", asset_id, type }`；references 缺失且无任何旧参考字段时以文本带入项新建单数组；旧参考字段（`reference_asset_ids`/首尾帧/素材库）与文本带入并存 → `400 invalid_reference`（防御性拒绝，新客户端提交一律走单数组不触发）。
- **容量与能力校验在合并后执行**：沿用既有 `checkReferenceLimits(features, references, "video")`（图/视频/音频分类上限、`video_reference`/`audio_reference` 能力位、参考总时长），文案与错误码沿用；前端视频面板同源（`@/lib/model-reference-limits` 同名实现）。
- **冻结**：`input.references` 为合并后最终序（帧在前、普通参考保序）；`text_attachments[].media` 与 `input.text_input_signature` 与图片目标同构（§5/§4）；重试沿用「原样复制 input」。
- **前端交互**：视频面板参考栏锁定标记、定位来源与 §6 图片面板同构（锁定条目不渲染移除入口）；「输入已更新」徽标扩展至视频目标（同一派生判定）；参考编号沿用视频面板既有 numberMap（同类型编号），文本卡显示编号不当作目标素材序号。

## 11. 音频目标扩展（IKFM41，v1.2）

v1.2（2026-09-15）按 §9 授权扩展音频生成目标；§1–§8 全部沿用（同一派生/签名/冻结实现），本节只新增目标类型语义。音频既有的「正文创作上下文」（IKFCXE `text_attachments` 组合与 IKFCJG §10 `prompt_doc` 冻结）语义不变：正文仍进组合提示词，本节带入的是正文 @ 索引解析出的**实际媒体素材**进参考栏，两者并存不冲突、不把普通创作正文当作逐字朗读稿。

- **适用范围**：`type=audio` 且携带 `target_node_id`。引用来源模型（直接参考 ∪ 文本带入参考，纯派生）与 §1 完全一致。
- **角色语义**：音频参考无角色槽，文本带入参考恒 `role=reference`（与既有音频参考连线模型一致）；同 assetId 去重保首见（音频参考只有本地画布素材，无 `material_id` 空间）。
- **接受的媒体类型**：`audio` 与 `image`（与既有 `validateAudioReferences` 接受范围一致；前端音频面板不提供图片添加入口的边界不变，文本带入是图片素材进入音频参考的唯一通道）。`video` 不接受 → `400 invalid_reference_type`（文案沿用 §3「文本索引包含目标不支持的媒体类型」）。
- **音频与图片不可混用沿用既有 seed-audio 限制**：合并后 audio/image 两类并存（文本带入内混用、或文本带入与直接参考跨来源混用）→ `400 invalid_reference`「音频与图片参考不可混用」（既有 `checkReferenceLimits(…, "audio")` 文案与错误码）；不静默丢任一类素材后发送。
- **并入规则**：直接参考（references 单数组保序）在前，文本带入按派生序追加尾部为 `{ role: "reference", asset_id, type }`；references 缺失且文本带入非空时以文本带入项新建单数组。音频本就禁旧参考字段（`validateAudioReferences` 拦截），无视频 §10 的旧字段防御分支。
- **容量校验在合并后执行**：沿用既有 `checkReferenceLimits(features, references, "audio")`（audio ≤ `audio_reference_max`、image ≤ `image_reference_max`、不可混用），文案与错误码沿用；无能力行时维持 `validateAudioReferences` 旧口径（不查分类上限）。
- **文本带入素材存在性/类型复核**：与视频 §10 同口径——`resolveInputAssets` 存在性/归属复核 + 声明 `mediaType` 与素材实际类型一致，保存与提交之间的素材替换不能绕过校验。
- **冻结**：`input.references` 为合并后最终序（直接参考保序、文本带入追加）；`text_attachments[].media` 与 `input.text_input_signature` 与图片/视频目标同构（§5/§4）；重试沿用「原样复制 input」。
- **前端交互**：音频面板参考栏锁定标记、定位来源与 §6 图片面板同构（锁定条目不渲染移除入口）；「输入已更新」徽标扩展至音频目标（同一派生判定）；参考编号沿用音频面板既有参考顺序编号，文本卡显示编号不当作目标素材序号。
