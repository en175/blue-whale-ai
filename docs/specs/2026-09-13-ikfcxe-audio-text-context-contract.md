# 音频文本上下文生成闭环契约（IKFCXE）

> ⚠️ **部分已由 [ADR-0088](../adr/0088-prompt-assembly-ownership-and-reference-marker.md) 取代**：
> 本契约中「双端优先消费非空白 `composed_prompt` 冻结正文」「附件由服务端组合进提示词」的条款
> 已作废——正文一律取提交方的 `parameters.prompt`，执行侧只读 `input.prompt`，不再回退附件组合。
> 音频参考素材的接纳与冻结部分继续有效。

## 时间

2026-09-13

## 背景与范围

父需求 IKFCVS（文本附件统一图标预览与音频上下文生成）的音频纵向闭环切片，工单 IKFCXE【后端】（含前端接线）。本切片把文本附件能力从图片/视频扩展到音频：画布文本卡与音频草稿目标的显式连线关系在提交时冻结进任务快照，执行与重试消费该快照，附件作为创作上下文与主提示词共同进入生成。

本契约定死跨进程字段与双端语义，并修订既有两篇契约被本切片反转的旧口径（见 §1）。前端展示与交互语义（文本图标、可进入浮层预览、× 仅断边）沿用 [IKFCJG 三态交互契约](2026-09-13-ikfcjg-attachment-thumbnail-interaction-contract.md) 及其 T3/IKFCKS 切片，本文不重复。

本文记录 IKFCXE 初始交付切片。后续用户已授权的音频正文索引标签验收修复扩展以 [IKFCJG 契约 §10](2026-09-13-ikfcjg-attachment-thumbnail-interaction-contract.md#10-音频正文接纳与执行闭环ikfcjg-验收修复) 为准；涉及正文接纳、冻结字段和执行优先级时，该节优先于本文初始边界。

## 1. 对既有契约的修订

- [IKDMQT 音频草稿契约](2026-09-07-ikdmqt-audio-draft-contract.md) 中「音频任务不推导文本附件……不冻结 `text_attachments`」「音频草稿对文本节点连线无附件语义」两条自本切片起废止：音频草稿目标与图片/视频同构推导并冻结文本附件，任务输入随连线改变。
- [IKFCJG 三态交互契约](2026-09-13-ikfcjg-attachment-thumbnail-interaction-contract.md) §8 对 T3/IKFCKS 的描述「文本卡作为创作上下文，不进生成请求」仅适用于该切片交付时点（纯前端范围）；自本切片起音频文本附件进生成请求。
- IKDMQT 的「`prompt` 为空时 400（音频无附件兜底）」继续有效：本切片不引入「仅附件生成」（见 §3）。

## 2. 冻结字段（接纳侧，backend）

- 仅当提交携带 `target_node_id`（音频草稿目标）时，`generation_jobs.input` 额外冻结 `text_attachments`；无目标节点的旧式音频任务无此字段，原规则不变。
- `text_attachments` 元素形状由 `packages/contracts/src/canvas-edges.ts` 的 `textAttachmentSnapshotSchema` 定死（strict）：`{ node_id: 非空 string, title: string, text: string, prompt_source?: 预览投影 }`；按画布连入边序排列。
- 附件身份 = 来源文本节点（`textNode`）与当前目标的显式连线，服务端读最新画布推导，不以客户端自报的来源标识代替；去重由连线层保证（同一来源到同一目标仅一条边），服务端按边序如实推导。
- `title` 仅为身份记录与展示用途，不进入组合正文；同名文本卡按 `node_id` 区分身份，不串用。

## 3. 接纳校验

- 目标必须是 `mediaNode` 且 `mediaType === "audio"`，否则 400（沿用 IKDMQT 目标校验）。
- 主提示词为空（trim 后）仍 400「prompt 无效」，即便附件正文非空——音频不引入仅附件生成。**2026-09-20 修订（IKH8AU）**：图片/视频同口径——正文由提交方给全（附件正文已拼进 `prompt`），空正文即 400，**「非空白附件驱动」这条旧兜底已与组合档一并退役**。
- 长度闸：正文全文超过**生效上限** → 400。生效上限 = 模型配置优先、未配置回落音频缺省（3000），定入 `backend/libs/contracts/prompt-text-limits.ts`。**2026-09-20（IKH4B8）**：本节的「组合长度闸」已退役——ADR-0088 起正文由提交方给全，附件正文就在 `prompt` 里，服务端不再二次叠加（原写法把附件算了两遍）；详见 [ADR-0085 修订二](../adr/0085-catalog-input-modality-model-alias-and-per-model-prompt-length.md)。
- IKFCXE 初始切片不新增音频正文索引标签编辑器，当时 `prompt_doc` 对音频一律拒绝；该历史限制已由 IKFCJG §10 授权扩展替代，最终按该节复核、编译并冻结音频 `prompt_doc`。

## 4. 执行消费（TS worker 与 worker-java 双端对齐）

- 双端消费同一 `input` 快照：解析 `text_attachments`，快照形状损坏（非数组/元素缺约定字段）整体按无附件处理，不阻断任务。
- 初始组合规则与图片/视频同源：非空白附件正文在前、主提示词在后，`"\n\n"` 连接，不改写正文；空白附件跳过。IKFCJG §10 扩展后，双端优先消费非空白 `composed_prompt` 冻结正文，仅在该字段不可用时回退本条组合规则。
- 不因存在附件强制改为朗读任务：环境音/配音/旁白意图由主提示词决定，应用不统一改写用户意图。
- 空主提示词的音频任务在执行侧同样拒绝（`hasNonBlankAttachment` 仅对 image 放行），与接纳侧口径一致。
- 重试复制原 `input` 快照，不回读当前文本卡；提交后来源的修改或移除不改写已提交任务。
- 已知双端差异登记：Java 空白判定 `isBlank`（`Character.isWhitespace`）与 JS `trim()` 对 NBSP（\u00A0）等不间断空白的取舍不同——纯 NBSP 正文 TS 过滤、Java 保留；接纳侧冻结的正文不产生此类输入，行为不受影响。

## 5. 边界

- 自由音频面板（从媒体节点直接「生成音频」打开、不绑定草稿卡、提交前无目标节点）不支持文本附件：附件关系以来源→目标显式边建模，自由面板提交走旧式无 `target_node_id` 任务。该边界为本切片明确记录的产品取舍，如需放开另行立切片。
- 文本附件不作为音频媒体参考：`references`（参考音频/参考图）语义不变，附件不占媒体参考名额。
- 真实音频模型的环境音/配音效果验收不在本切片闭环内，另行实测。

## 6. 验证与关联

- 集成（真实业务 API + 隔离 MySQL）：`backend/apps/blue-whale/src/api/canvases/text-attachment-audio.integration.test.ts`——冻结与边序、目标校验、空提示词拒绝、旧式无附件兼容、组合超限、移除仅断当前目标、重试消费原快照、同名卡身份、来源更新后新提交 + 浏览器段（选择/去重/预览/移除/发送/刷新恢复）。
- 执行器：`worker-java` 的 `AudioJobProcessorTextAttachmentTest`（组合/快照损坏/空白跳过/无附件兼容）；TS 侧 `backend/libs/shared/generation/worker/generation-worker.test.ts`。
- 前端：`web/src/pages/CanvasPage/audioDraft.test.tsx` 及 AudioDialog 相关套件（见 IKFCJG 契约 §8）。
- 关联契约：[IKFA1P 文本附件提示词引用契约](2026-09-13-ikfa1p-text-attachment-prompt-ref-contract.md)（组合与编号清单语义来源）、[IKDMQT 音频草稿契约](2026-09-07-ikdmqt-audio-draft-contract.md)（草稿与任务身份）、[IKFCJG 三态交互契约](2026-09-13-ikfcjg-attachment-thumbnail-interaction-contract.md)（展示与交互）。
