# ADR-0123：比例档位的展示名与「定义/引用」不变式

- **状态**：Accepted
- **日期**：2026-10-08
- **决策者**：lixq
- **关联**：[ADR-0085](0085-catalog-input-modality-model-alias-and-per-model-prompt-length.md)（能力目录与别名）、[ADR-0086](0086-model-capability-reference-limits-configurable.md)（能力行可配项）、[ADR-0052](0052-cross-process-contracts-and-versioning.md)（跨进程契约与版本化）
- **工单**：IKJZ33（父）/ IKJZ3G（后端）/ IKJZ3M（前端）
- **影响面**：`generation_model_capability.supported_aspect_ratios` 的元素形态、backend 读侧与写闸门、`/api/generation/models` 消费端契约、产品端三处比例选择器

## 背景

能力行里两个「档位列表」字段的形态不一致：

| 字段 | 形态 | 产品端能不能填展示名 |
| --- | --- | --- |
| `supported_sizes` | `[{id, label}]` | 能——`ChatBox` 下拉渲染 `s.label`（`web/src/pages/Home/components/ChatBox/index.tsx:1391,1399`） |
| `supported_aspect_ratios` | `["16:9", …]` | 不能——只有一个值，产品端只能显示字面（`ChatBox/index.tsx:587,1164`、`CanvasPage/components/ImageDialog/index.tsx:254`） |

身材相同的两个字段，一个有展示名一个没有，运营在管理端也无处填写比例的人类可读名。这是本次要补的洞。

## 决策

### 1. 元素升级为 `{id, label}`

`supported_aspect_ratios` 由 `string[]` 升级为 `{id, label}[]`，与 `supported_sizes` 同形。

- **读侧宽容**：裸字符串按 `{id, label: id}` 归一。存量行不必迁移，被保存时才升级。
- **写侧一律写对象**；`label` 为空或 `label === id` 时**不写该键**（同 `sizeToWire` 对空 label 的处理）。

### 2. 定义处唯一，其余全是引用

`supported_aspect_ratios` 是比例的**定义处**，唯一带展示名。以下三处都是**引用**，一律存比例 id 字面、**不带 label**：

- `default_aspect_ratio`（能力行列）
- `features.video_dimensions` 的键 `aspect_ratio=…`
- `features.task_types[].allowed_ratios`

这条不变式与尺寸完全同构：`supported_sizes` 是定义带 label，而 `default_size`、`request_mapping.matrix` 的行键、输出像素表的键都是引用存 id。由此**引用型字段一处都不用改**。

### 3. 消费端：子集跟着走，不做 join

`available_aspect_ratios` 不是独立结构，而是 `availableAspectRatiosForSize`（`backend/libs/shared/generation/image-channel-parser.ts:326-343`）对同一份列表做的 `filter`。定义处带上 label，子集天然带着 label 过滤出来，无需 join，也不会出现「label 与比例对不上」的孤儿。

### 4. 缺省回落不物化

`label` 缺省时显示 `id`（= 现状行为）。实现用**输入框 placeholder**，不是值：运营留空就一直按 id 显示，库里不写 `label`。

若把缺省值物化进库，存量行第一次「打开看一眼再保存」就会写入一批与 id 相同的 `label`——既是冗余数据，又白白触发一次能力 digest 漂移。

## 被否掉的备选

**把 label 放进 `features.aspect_ratio_labels` 旁表**（`supported_aspect_ratios` 保持 `string[]`）。

它有一个真实优点：`features` 不在 `capability-digest.ts:14-22` 的 8 字段集内，因此零 digest 漂移。但仍被否掉，两个理由：

1. **孤儿风险**。「一个数组 + 一张按字符串对齐的旁表」，比例一改名或删除，label 就成了无人清理的孤儿，而数据结构本身不会暴露这件事。元素内带 label 则不可能错位。
2. **省下的代价是假的**。digest 漂移本就是能力行**任何一次编辑**的常态（`storyboard-preview-repo.ts:194` / `scene-card-generation-repo.ts:537` 按 `row_version + digest` 判漂移；IKHTVR 刚删过 `supported_sizes` 的宽高，同样触发）。代价并没有被免除，只是被搬到另一条路径上。

**只加给管理端看**（产品端继续显示 `16:9`）同样被否：那样这个字段没有任何读方，不值得为它改形态、改消费端契约。

## 影响

- `capability_digest` 的**字段集不动**——只改其中一个字段的值形态。改字段集才会让历史快照全部误判漂移；改值形态属正常的编辑后果。
- worker-java 不受影响：它只读 job input 里的 `aspect_ratio` 字符串，不读能力行的比例清单。
- 比例的顺位、图标等其它属性不在本次范围。
