# 旧生成卡迁移契约（IKDLQK）

## 时间

2026-09-07


> **保留期更新（2026-10-27，IKQY3O）**：`legacy_card_history` 已改名为 `project_card_migration_history`，并引入 180 天保留期。本文「历史只增不改 / 只读事实」的表述按「180 天内只读、超期由 `backend/scripts/cleanup-project-card-migration-history.mjs` 清理」理解；超过保留期的节点不再保证能按历史回放。

## 目标与边界

落实 IKDL9U 的迁移切片：已有项目重新打开后，画布 JSON 中的旧生成卡（`assetNode` 且 `data.kind === "generation"`，正文在 `data.generationCard`）转换为普通文本节点，旧画面描述及用户编辑保存在只读历史中可查阅。复用现行 NestJS Canvas API、Prisma 的 canvas JSON 与版本锁、IKDLQE 的普通文本节点与限长契约；不引入新的卡片资源类型，不改变生成任务接纳与快照行为，不做整图执行或批量应用。

## 识别与转换

识别谓词：`node.type === "assetNode"` 且 `node.data?.kind === "generation"`。正文块为 `node.data.generationCard`（旧 `GenerationCardBlock`：`shotTitle` / `timeRange` / `visual` / `prompt` / `assetRefs` / `assetRefItems` / `cardId` / `shotNo` / `source` 等，字段全部可能缺失）。

转换产物为普通文本节点，规则：

- `id` 保留原节点 id（连线与已有引用不断）；`type` 变为 `textNode`；`position` 原样保留。
- `data.title` ← `generationCard.shotTitle`（缺失或非字符串时为 `""`，不落假标题）。
- `data.text` ← `generationCard.prompt`，即迁移时画布中实际保存的提示词正文（含用户编辑）；不回读独立 Agent 的原始 revision，不用 `visual` 兜底。
- `data.promptSource` ← 仅当 `generationCard.source` 通过 IKDLQE `previewSourceSchema` 校验且其来源键在迁移后画布中唯一（既有 `promptSource` 节点与其他迁移卡一起判重，先扫描到者保留）时携带；无来源或来源损坏/重复的节点不伪造预览来源，来源事实仍保存在历史记录中。
- `generationCard` 及其余旧字段从节点移除，完整原资料转入历史记录。

迁移后节点即普通文本节点：编辑、换行、复制粘贴、长文折叠、删除与刷新恢复全部沿用 IKDLQE 链路，服务端保存校验（限长、`promptSource` 不变性与唯一性、If-Match）对其同等生效。

## 历史保存

新增不可变表 `legacy_card_history`（Prisma migration `20260907120000_ikdlqk_legacy_card_history`，与 `schema/018_ikdlqk_legacy_card_history.sql` 同步；沿用 IKDLQE/IKDLQJ 先例，新表不回写 `schema/001_baseline.sql`）：

| 列 | 类型 | 含义 |
| --- | --- | --- |
| `id` | BIGINT 自增主键 | 历史记录 id（接口返回字符串） |
| `project_id` | BIGINT | 项目归属 |
| `node_id` | VARCHAR(128) | 原生成卡节点 id（＝迁移后文本节点 id） |
| `title` | VARCHAR(200) | 迁移时标题 |
| `prompt_text` | MEDIUMTEXT | 迁移时实际保存的提示词正文 |
| `visual_text` | MEDIUMTEXT NULL | 旧画面描述及用户编辑（缺失为 NULL） |
| `source_json` | JSON NULL | 预览来源三件套（无来源为 NULL） |
| `card_json` | JSON | 迁移时完整 `generationCard` 原资料 |
| `gmt_create` | DATETIME(0) | 首次迁移时间 |

`(project_id, node_id)` 唯一。历史写入必须先于画布转换写入：同一轮迁移先 `createMany ... skipDuplicates` 落历史，再条件写画布。历史只增不改；迁移后用户对文本节点的任何编辑不回写历史。

## 迁移触发与并发

迁移在两条项目打开读取路径上触发：`GET /api/projects/:id/snapshot`（主路径）与 `GET /api/canvases?projectId=`（回退路径）。生成任务接纳等其他读画布路径不触发迁移。

每轮迁移：读取最新画布与本项目全部历史记录 → 计算转换计划 → 先落历史 → `saveIfVersion` 条件写画布；版本冲突或并发唯一键写入死锁（MySQL 1213）重读重算，最多五次。转换输出是确定的（节点 id、正文、标题均来自原数据或既有历史），并发打开不产生重复节点或重复历史；历史已存在而节点仍是旧卡（上次历史落库后画布写入失败）时，按历史记录内容完成转换，恢复不丢失历史，也不使用打开时的卡片现值覆盖历史。迁移永不阻断打开：重试耗尽时返回当前画布原样，旧卡保持可用，等待下次打开重试。

重复打开是幂等的：已转换节点不再是旧卡，不会被重复扫描；不创建重复节点，不覆盖迁移后的正文编辑。

## 异常与反馈

以下情形该卡不迁移、原节点原样保留（继续按旧生成卡渲染和编辑），不写历史记录，也不用 `visual` 代替缺失提示词：

- `generationCard` 缺失或不是对象，或 `prompt` 缺失/非字符串（含空对象损坏）→ 原因「提示词缺失或已损坏」；
- `prompt` 超过正文存储限长（100,000 UTF-16）→ 原因「提示词超过存储限长」；
- `shotTitle` 超过标题存储限长（200）→ 原因「标题超过存储限长」。

失败是无状态的：每次打开重新评估，用户修好原卡（如补写提示词）后下次打开即正常迁移。

迁移报告随打开响应返回（新增可选字段，无旧卡或全部成功且无迁移发生时缺省）：

```
legacy_migration?: {
  migrated: string[];                       // 本轮转换的节点 id
  failed: { nodeId: string; title: string; reason: string }[];
}
```

`snapshot` 响应在顶层携带该字段；`GET /api/canvases` 响应在 data 内携带同名字段。前端据此提示：有转换时提示已转换数量；有失败时明确提示「旧生成卡未能迁移」及卡片标题与原因，并说明原卡片已保留。

## 历史查阅接口

`GET /api/canvases/:projectId/legacy-card-history`（需项目归属），成功信封 data：

```
{ items: LegacyCardHistoryItem[] }

LegacyCardHistoryItem = {
  historyId: string;        // 记录主键字符串
  nodeId: string;           // 迁移后文本节点 id
  title: string;
  promptText: string;       // 迁移时提示词正文
  visualText: string | null;
  source: PromptPreviewSource | null;
  cardJson: unknown;        // 完整原 generationCard
  migratedAt: string;       // ISO 时间
}
```

按 `id` 升序。历史是只读事实：无写接口；节点后续编辑或删除不影响历史。

## 前端行为

- 迁移后节点即普通文本节点，呈现、编辑、保存零特殊分支；仍为旧卡的节点按现行旧生成卡路径渲染，不被前端静默改写。
- 项目打开时若响应携带 `legacy_migration`：有迁移显示成功提示，有失败显示警告提示（含标题与原因）。
- 画布页顶栏提供项目级「迁移历史」只读入口（存在历史时出现）：打开展示本项目全部历史条目（标题、画面描述、迁移时提示词、时间与来源）。条目只读，无编辑入口。
- 历史读取失败或无历史记录时入口隐藏（静默降级），不打断画布使用。

## 验证

测试边界沿用母规格与 IKDLQE 先例：公开接口集成测试使用本地隔离 MySQL 与真实 Nest 应用；真实浏览器验收集成在同一集成测试文件内，经 Vite dev server 代理打真实 API 与测试存储。不以外部 Agent 为依赖（迁移不回读 Agent）。

集成测试覆盖：打开即迁移并保留标题/位置/用户编辑正文；重复打开幂等与迁移后编辑不被覆盖；无来源不伪造、重复来源去重；缺失/损坏/超限保留原卡且报告原因；历史先落库后的失败恢复；历史接口归属与只读回读；并发打开结果一致。浏览器用例覆盖：打开旧项目 → 文本节点呈现 → 编辑正文 → 刷新恢复 → 迁移历史只读查阅。

复现命令：`IKDLQK_BROWSER=1 IKDLQK_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdlqk pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/legacy-card-migration.integration.test.ts`。数据库必须是预先应用当前 Prisma schema（含本迁移）的隔离测试库，测试创建独立项目，不清理其他项目。
