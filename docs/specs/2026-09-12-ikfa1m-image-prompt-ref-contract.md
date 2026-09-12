# 生图正文素材标签（prompt_doc）契约

## 时间

2026-09-12

## 背景与范围

工单 IKFA1M（父需求 IKFA1J）第 1 条验收要求：实现前先落定正文/草稿格式版本、标签位置与稳定身份、请求及错误响应、冻结快照和旧客户端防丢失契约及样例。本文是该契约的权威记录；代码侧权威实现在 `packages/contracts/src/prompt-doc.ts`。

本票范围为生图链路。生视频的多媒体标签与首尾帧角色（IKFA1O）、文本附件标签（IKFA1P）、失效自动恢复与交互式修复（IKFA1N）不在本契约内，但本契约的字段形状为后续各票的同构基础。

## 术语对齐

- **正文素材标签**：正文中的一个原子提及，展示为「图片N」或「已失效：原图片N」。
- **稳定身份**：本地 Asset 纯数字 id。名称、缩略图、URL 外观、画布位置都不是身份。
- **展示编号**：图片N，由身份在**最终有效输入顺序**中的位置派生；编号不是身份。
- **失效素材标签**：身份不在当前有效输入集合中的标签；保留原身份与原编号，不转向其他素材。

## 1. 正文结构（prompt_doc v1）

正文 = 片段序列；**标签位置由片段顺序隐式表达，不使用字符区间**（避免计数单位与范围校验问题）。

```json
{
  "version": 1,
  "segments": [
    { "kind": "text", "text": "让" },
    { "kind": "asset_ref", "asset_id": "102" },
    { "kind": "text", "text": "的人物穿上" },
    { "kind": "asset_ref", "asset_id": "101" },
    { "kind": "text", "text": "的衣服" }
  ]
}
```

- `version`：只有 `1`。未知版本拒绝，不猜造、不迁移。
- `asset_id`：本地 Asset 纯数字 id（正则 `^[1-9][0-9]*$`）。
- `label`（可选）：展示编号缓存，由客户端编辑期维护（如 `图片2`）。**服务端从不消费该字段**——编译编号一律按最终输入顺序派生；它的唯一用途是失效那一刻能引用「原编号」。
- `invalid_label`（可选）：失效恢复信息，记录失效前的展示编号（如 `图片2`）。**存在即失效标签**。
- strict：未知字段、未知 kind 一律拒绝。
- 上限：segments ≤ 500（防御性上限，防畸形请求放大编译开销）。

## 2. 编号与编译规则

- 展示编号：`图片N = asset_id 在最终 input_asset_ids（保序）中的下标 + 1`。
- 编译：每个有效标签替换为其展示编号，文字原样拼接；**同一素材多次提及编译为同一编号**；正文未提及的参考不参与正文（保持既有输入语义，仍随 `input_asset_ids` 提交）。
- 正文出现顺序不改变媒体输入顺序：先提图片2 再提图片1，编译结果仍指向真实输入顺序（D1）。
- 前端附件区、@ 菜单、正文标签三处的编号与服务端编译使用**同一规则同一顺序**（前端顺序 = 提交时 `input_asset_ids` 顺序，二者同源构造）。

## 3. API 接纳（POST /api/projects/:id/generation-jobs）

### 请求

- 新增可选顶层字段 `prompt_doc`（结构见 §1）。**仅 `type=image` 允许携带**；video/audio 携带 → `400 unsupported_input`。
- `parameters.prompt` 语义不变，仍按现有规则校验（非空 / ≤4000 字）。新客户端将其填为**拍平镜像**（标签渲染为 `图片N`、失效标签渲染为 `已失效：原图片N` 的纯文本）。
- **`prompt_doc` 存在时以它为权威编译源**：编译结果替代 `parameters.prompt` 进入任务快照 `input.prompt`；不做 `prompt` 与 `prompt_doc` 的一致性交叉校验（编译以结构为准，漂移无影响）。

### 服务端复核（在参考图存在性/归属/类型复核之后执行）

| 场景 | 响应 |
| --- | --- |
| `prompt_doc` 结构/版本非法 | `400 invalid_input`（"prompt_doc 无效"） |
| video/audio 携带 `prompt_doc` | `400 unsupported_input` |
| 存在带 `invalid_label` 的失效标签 | `400 invalid_reference`（存在失效的素材标签，须删除后提交） |
| 标签 `asset_id` 不在最终 `input_asset_ids` 集合（引用关系不符、越权、非图片参考已被上游拒绝） | `400 invalid_reference`（正文素材标签指向无效的参考素材） |

前端失效提示不替代服务端复核；保存与提交之间的素材变化（参考被移除、越权、删除）以接纳当下复核为准。

## 4. 冻结快照与执行/重试

- `job.input.prompt` = **编译后正文**（worker 现有消费路径零改动）。
- `job.input.prompt_doc` = 原始结构快照（冻结，供审计与追溯；重试原样复制 `input`，自动消费同一快照）。
- `job.input.input_asset_ids` 顺序冻结不变（现有行为）。
- 文本附件（`text_attachments`）组合规则不变：附件正文按序在前、编译后提示词在后（D5：主提示词标签与方案附件共用同一次最终输入，媒体编号只由 `input_asset_ids` 派生，两套表达不互相编号）。
- 接纳后修改草稿、删除素材、改变编号，均不影响已冻结任务；重试消费原快照（D3）。
- 旧任务无 `prompt_doc` 字段：执行语义完全不变（E5）。

## 5. 草稿持久化与旧客户端防丢失

草稿随画布文档存于草稿媒体节点 `data`（现有机制，无新表新列）：

| 字段 | 写入方 | 内容 |
| --- | --- | --- |
| `promptDoc` | 新客户端 | `{ version: 1, segments: [...], flat: string }` —— `flat` 为拍平镜像 |
| `prompt` | 新旧客户端 | 新客户端写同一个 `flat`；旧客户端写用户编辑的纯文本 |

**恢复判定（新客户端打开草稿）**：

1. `promptDoc` 存在且 `promptDoc.flat === prompt` → 按结构恢复：有效标签按当前输入**重新派生编号**，带 `invalid_label` 的标签保持失效展示（C4）。
2. 不等或 `promptDoc` 不存在 → 按纯文本草稿恢复：**不从"图片1"等旧文字猜造标签**（E1）。

**防丢失语义**：旧客户端只读写 `prompt`。旧客户端保存后 `prompt ≠ promptDoc.flat` → 新客户端下次恢复走规则 2，旧客户端的编辑原样保留；新客户端再次编辑后重新建立结构（用户重新插入标签）。反向不成立：新客户端写入的两字段同步更新，旧客户端读到的是可理解的拍平文本。

**失效与恢复边界（本票）**：标签一旦失效（写入 `invalid_label`），本票内不做自动恢复；用户可删除失效提及后重新 @ 插入。自动恢复与点击失效标签替换在 IKFA1N 完成。

## 6. 错误响应样例

```json
{ "code": 1034, "msg": "正文素材标签指向无效的参考素材" }
{ "code": 1034, "msg": "存在已失效的素材标签，请删除后再提交" }
{ "code": 1002, "msg": "prompt_doc 无效" }
{ "code": 1004, "msg": "正文素材标签暂仅支持图片生成" }
```

## 7. 验证与关联

- 契约单测：`packages/contracts/src/prompt-doc.test.ts`（结构、编号、编译、校验）。
- 接纳与快照：`backend/libs/shared/generation/handle-create-generation-job.ts` 及其单测；隔离库集成测试见 `backend/apps/blue-whale/src/api/canvases/` 同模式新增文件。
- 执行端：worker 消费 `input.prompt`（已编译）+ `input_asset_ids`，记录式供应商替身断言最终正文与图片顺序。
- 关联：IKFA1J（父需求）、IKFA1M（本票）、IKFA1N/O/P（后续票）；产品语义见 `docs/specs/2026-09-12-generation-prompt-reference-index.md`。
