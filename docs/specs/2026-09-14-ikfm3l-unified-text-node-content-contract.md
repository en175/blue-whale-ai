# 统一文本卡正文契约 v1（IKFM3L）

日期：2026-09-14
状态：定稿（跨层实现前的版本化契约）。
来源：IKFLZT 统一画布文本节点规格实现决策 5；本契约定死统一正文结构、兼容升级与版本演进边界，前后端与 Worker 以此为准，不得各自发明字段。

## 1. 权威正文字段

- 文本卡（`type: "textNode"`）正文的唯一权威字段是 `data.text: string`，内容为**受限 Markdown 子集**（第 2 节）。
- `data.html` 自本契约起**退役为读兼容字段**：新写入不再产生；仅存量节点在升级前保留（第 5 节）。
- `data.text` 长度上限沿用 `PROMPT_TEXT_LIMITS.text`（100 000 字）；保存 API 对 `data.html` 补同值限长，消除存量 HTML 节点绕过正文限长的漏洞。
- `data.title`、`position`、节点 `id`、`edges` 关系与卡尺寸规则不变；升级不得通过删除重建节点完成。

## 2. 受限 Markdown 子集（v1 固定八类）

| 类别 | Markdown 语法 | 渲染 HTML（白名单） |
| --- | --- | --- |
| 标题 1–3 | `# ` / `## ` / `### ` 行首 | `<h1>`–`<h3>` |
| 正文段落 | 空行分隔的普通行 | `<p>` |
| 粗体 | `**文本**` | `<strong>`（兼容 `<b>`） |
| 斜体 | `*文本*` | `<em>`（兼容 `<i>`） |
| 无序列表 | 行首 `- ` 或 `* ` | `<ul><li>` |
| 有序列表 | 行首 `1. ` `2. ` … | `<ol><li>` |
| 分隔线 | 独立行 `---` | `<hr>` |
| 软换行 | 行内换行 | `<br>` |

- 子集之外的 Markdown 语法（表格、代码块、链接、引用、图片等）不属于 v1：以字面文本对待，不渲染为格式，也不得声称支持。
- 任何 `data.text` 字符串都是合法 v1 内容（纯文本是子集的退化形态），保存 API 不做语法校验，仅限长。

## 3. Agent 绑定字段语义不变，区间锚定 Markdown 源

- `data.promptSource` / `data.promptOriginalTitle` / `data.promptMaterials` 语义与防伪造规则（无 `promptSource` 不得携带绑定字段）沿用 prompt-preview 契约，不变。
- `data.promptMentions` 的 `{ start, end, index, assetId }` 区间语义升级为：**锚定 `data.text`（Markdown 源字符串）的字符下标**。此前锚定纯文本正文；因纯文本是 Markdown 子集的退化形态，存量区间在未编辑格式的卡上天然兼容。
- 标签 chip 是原子：序列化时标签文本不处于行内格式标记内部（编辑器拆开跨越标签的粗体/斜体），保证区间切分不撕裂格式标记。
- 后续 IKFM3Q 的媒体索引标签在同一区间模型上扩展（分媒体类型编号、失效语义、关系线），不得复活 `data.html` 通道或文本卡附件列表。

## 4. 正文消费者兼容（最小过渡）

- `extractTextNodeText(data)`：`data.text` 直读分支语义不变——现返回含 Markdown 格式标记的源文本；`data.html` 投影分支保留，服务升级前的存量卡。
- 生成链路冻结（`text_attachments[].text`、方案引用 `readPromptPlan`）随 `data.text` 携带 Markdown 标记：格式标记是「正文、格式所表达的文本内容」的忠实表达，直接进入生成输入，不做剥离。
- worker-java 只消费冻结快照，本契约不改变其输入形态，零适配。

## 5. 历史卡升级（读时归一化，非批量大迁移）

| 存量形态 | 升级动作 |
| --- | --- |
| 仅 `data.text`（纯文本卡 / Agent 绑定卡） | 零迁移（纯文本是合法子集） |
| 仅 `data.html`（HTML 卡） | 水合时 `htmlToMarkdown(data.html)` 写入 `data.text`，移除 `data.html`；白名单外标签（颜色、字号等）降级为纯文本 |
| `data.text` 与 `data.html` 并存（文本生成卡产物） | 以 `data.text` 为准，移除冗余 `data.html` |

- 升级发生在前端画布水合时，随 800ms 防抖自动保存自然落盘；后端 GET 不改写存量数据。
- 升级保真边界：八类格式保留；白名单外样式降级为文本，不保留原 HTML 副本。
- 新建文本卡（工具栏、右键菜单、画布粘贴、文本生成草稿、Agent 手动应用）一律直接产出 v1 形态（仅 `data.text`，Agent 卡另带绑定字段）。

## 6. 契约函数（packages/contracts/src/text-node-markdown.ts）

- `htmlToMarkdown(html: string): string` —— 受限 HTML → Markdown 源（升级用，同构纯函数）。
- `markdownToSanitizedHtml(md: string): string` —— Markdown 源 → 白名单 HTML 字符串（渲染用；输出只含第 2 节白名单标签与转义文本，可直接注入编辑器）。
- `renderMarkdownInline(md: string): string` —— 单段行内渲染（粗体/斜体/转义），供编辑器切分标签区间后拼接 chip。
- 转换幂等：`htmlToMarkdown(markdownToSanitizedHtml(md)) === md`（对 v1 子集内容）。

## 7. 测试接缝

- 主接缝沿用真实 Canvas 浏览器操作 → 业务 API → 隔离数据库；四类来源矩阵（普通新增、Agent 应用、历史纯文本、历史 HTML）验证编辑/刷新恢复与升级落库。
- 带 `promptSource` 的画布种子只能直写数据库（保存 API 拒绝伪造绑定字段），沿用 prompt-ref-text 集成测试模式。
