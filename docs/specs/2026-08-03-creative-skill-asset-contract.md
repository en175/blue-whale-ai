# Creative Skill 资产契约（官方/个人领域边界、公开元数据与稳定身份）

- **状态**：Accepted for implementation
- **契约版本**：7（v2 纳入 IK60WT 技能库浏览扩展：分类/排序/使用人数/i18n，见 §11；v3 纳入 IK60WX 添加官方技能的同名冲突语义，见 §5.2/§6/§7；v4 纳入 IK60WZ 个人技能只读正文与永久删除端点，见 §13；v5 纳入 IK60X0 草稿 AI 格式化端点与 `100104`，见 §6/§7/§14；v6 纳入 IK60X1 对话总结保存个人技能，见 §15；v7 纳入 IK60X2 个人技能自动匹配与服务端确定性 auto 激活，见 §3/§4/§10/§16）
- **关联工单**：[01 — 建立官方与个人 Creative Skill 安全边界](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60WS)、[02 — 一比一还原官方技能库浏览体验](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60WT)、[05 — 添加官方技能并统一“我的技能”资产视图](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60WX)、[07 — 个人技能只读查看、复制与永久删除](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60WZ)、[08 — 接入 SKILL.md AI 格式化工具](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60X0)、[09 — 从当前对话总结并保存个人技能](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60X1)、[10 — 统一自动匹配、版本事实与浏览器纵向验收](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60X2)
- **父需求**：[一比一还原 Creative Skill 面板与个人技能资产闭环](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60US)
- **前置契约**：[Creative Skill 激活跨服务契约](2026-07-24-creative-skill-activation-contract.md)（激活、版本固定与按需正文读取，本文不改写其字段）、[ADR-0041 同族工单串行与契约先行](../adr/0041-sibling-issues-serial-contract-first.md)

本文冻结 Creative Skill 作为**资产**的领域边界：官方技能、个人技能、用户添加的官方引用
是三个独立领域概念；面向普通用户的接口只暴露经批准的公开元数据；注册与调用始终使用
稳定身份 `creative_skill_id`；个人技能带唯一 owner，跨用户读取、修改、删除或调用均被拒绝。
本文只定义领域概念、字段白名单、身份规则与错误语义，不定义创建流程 UI、推荐算法或
运营后台。

## 1. 术语与三个领域概念

1. **官方技能目录（Official Skill Catalog）**：平台预配置资产的公开目录，存储于旧 `skill`
   表（`source='official'`）。公开元数据（名称、简介、封面、排序）与正文 `content` 同表
   存储，但**正文永不在任何面向普通用户的读取路径出库**。
2. **版本化技能身份（CreativeSkill / CreativeSkillVersion）**：激活契约 §1 定义的稳定身份
   与不可变版本，存储于 `creative_skill` / `creative_skill_version`。两表自本契约起归属
   Node-owned schema（`packages/persistence/prisma/schema.prisma` 为权威模型，
   `packages/persistence/schema/001_baseline.sql` 为全新环境基线；Java Flyway 链已退役，
   存量库补列见 §10），并携带两个领域字段：
   - `asset_domain`：`official` | `personal`，区分官方与个人两个领域，默认 `official`；
   - `owner_user_id`：`BIGINT NOT NULL DEFAULT 0`，`0` 表示平台（官方资产）；个人资产为
     所属用户 ID。
   官方与个人技能共用同一张版本化身份表与同一条受信任正文读取链；不另建个人正文存储。
3. **官方技能引用（User Skill Reference）**：用户与官方技能之间的添加关系，存储于
   `user_skill`（`user_id` + `skill_id`，逻辑删），携带关系属性 `auto`。引用只指向官方
   技能；**个人技能不是引用，不进入 `user_skill`**，凭 ownership 出现在「我的技能」。

## 2. 稳定身份规则（注册与调用）

1. 所有面向普通用户的技能视图与命令，**唯一公开主键是 `creative_skill_id`**
   （`^[a-z][a-z0-9_]{2,79}$`）。旧 `skill.id` / `user_skill.skill_id` 自增主键是库内实现
   细节，**不再出现在任何 wire 字段**。
2. 注册命令（添加引用 `add`、移除引用 `remove`、自动开关 `setAuto`）以 `creative_skill_id`
   寻址，服务端经 `creative_skill.source_skill_id` 解析回目录行；解析不到 `official` 域
   映射（含个人技能 ID、未知 ID、格式非法）一律按「不存在」处理（§7）。
3. 调用（激活）继续使用激活契约的 `forced_creative_skill_id` / auto 候选，只携带稳定
   Skill ID，不携带版本；版本由服务端解析当前发布版本并固定。
4. **名称只用于展示与冲突校验**（§5），不成为运行时主键，不参与任何注册或调用寻址。

## 3. 公开元数据白名单

面向普通用户的技能视图只允许下列字段（wire 一律 snake_case）：

| 字段 | library 视图 | mine 视图 | 说明 |
|---|---|---|---|
| `creative_skill_id` | ✓（可空） | ✓（可空） | 稳定身份；目录行缺版本化映射的环境为 `null`，此时命令按不存在处理 |
| `name` | ✓ | ✓ | 展示名；library 视图按 §11.4 语言解析返回 |
| `description` | ✓ | ✓ | 公开简介；library 视图按 §11.4 语言解析返回 |
| `cover_url` | ✓ | ✓ | 封面；个人技能恒为 `null`（封面按名称确定性生成，归创建工单） |
| `source` | ✓ | ✓ | 目录来源（官方恒 `official`） |
| `asset_domain` | ✓ | ✓ | `official` / `personal`（UI 来源标记用） |
| `added` | ✓ | — | 当前用户是否已添加引用 |
| `category` | ✓ | — | 目录分类（§11.1），v2 新增 |
| `usage_count` | ✓ | — | 成功激活去重用户数（§11.3），v2 新增 |
| `auto` | — | ✓ | 自动匹配开关；官方行为引用关系属性，个人行为本体属性（§16，v7 起返回真实值） |

- **禁止字段**：`content`、`body`、`prompt`、内部规则、版本号、digest、自增主键及任何
  未列入上表的字段，不得出现在面向普通用户的技能响应中。BFF handler 必须显式 pick
  白名单字段，不得原样透传上游对象。
- 普通用户无任何官方技能详情、正文或复制接口；本契约不新增此类端点。

## 4. 所有权与可见性矩阵

| 操作 | 官方技能 | 个人技能 |
|---|---|---|
| 读公开元数据（library/mine 列表） | 所有用户 | 仅 owner（经 mine 并集返回） |
| 添加/移除引用 | 所有用户（自己的引用） | 不适用（无引用概念） |
| 设 auto | 所有用户（自己的引用） | 仅 owner（§16，v7 起） |
| 读正文 / 复制 | 任何用户都不可（仅受信任运行时按 pin 读取） | 仅 owner（§13 只读端点） |
| 修改 / 删除 | 任何用户都不可（运营通道不在本文范围） | 修改不适用（在线编辑为非目标）；删除仅 owner 且**不可逆**（§13），跨用户一律按不存在处理 |
| 调用（forced 激活） | 所有用户 | 仅 owner；跨用户按 `CREATIVE_SKILL_UNAVAILABLE` 拒绝 |
| auto 候选 | `user_skill.auto` 派生 | `creative_skill.auto_match` 派生，仅 owner 本人（§16，v7 起） |

- 跨用户读取、修改、删除或调用个人技能，服务端**必须**按「不存在 / 不可见」拒绝
  （404 语义），不得泄露资产存在性。
- 所有权与域校验在持久化、BFF/API 与调用入口三层各自重复执行，不依赖前端保护。
  当前调用入口的唯一 live 缝是 Node 消息接纳（§8）。

## 5. Name Key 与冲突语义（仅冻结算法）

1. **Name Key**：对显示名依次做 去首尾空格 → 合并连续空白为单个空格 → Unicode NFC
   规范化 → 英文大小写折叠（`toLowerCase`）。Name Key 只用于冲突判断；原始显示名
   原样保留用于展示。
2. **冲突域**：同一账户内个人技能 Name Key 唯一；官方技能名称在官方库全局唯一，并对
   个人技能创建/上传形成保留名称。不同账户的个人 Name Key 互不影响。
3. `name_key` 存储列与创建时校验已由 IK60WU 落地：`creative_skill.name_key VARCHAR(255)`，
   索引 `idx_owner_name_key(owner_user_id, name_key)`；创建时应用层校验同用户个人唯一 +
   官方保留名。
4. **添加官方技能的反向冲突（IK60WX）**：执行 `add` 命令时，若同账户已存在与目标官方
   技能同 Name Key 的个人技能，拒绝添加并返回 §7 `100103`；该官方技能的直接使用
   （forced 激活）不受影响。用户须先删除同名个人技能，才能添加该官方技能。

## 6. 接口形状（BFF）

既有 5 个端点路径不变，仅**寻址主键由自增 id 切换为 `creative_skill_id`**：

| 端点 | 变更 |
|---|---|
| `POST /api/agent/skills/library` | 响应记录按 §3 白名单，主键 `creative_skill_id`；v2 起请求体扩展 `{ keyword?, category?, sort?, lang?, pageNum?, pageSize? }`（§11.5） |
| `POST /api/agent/skills/mine` | 响应为官方引用 ∪ 名下个人技能的并集，主键 `creative_skill_id`，含 `asset_domain`；IK60WU 起统一按添加/创建时间倒序 |
| `POST /api/agent/skills/library/{id}/add` | `{id}` 语义改为 `creative_skill_id`；非官方域或未知 ID → 100100；与同用户个人技能 Name Key 冲突 → 100103（IK60WX，§5.4） |
| `DELETE /api/agent/skills/mine/{id}` | `{id}` 语义改为 `creative_skill_id`；仅删引用，不删技能本体 |
| `PATCH /api/agent/skills/mine/{id}` | `{id}` 语义改为 `creative_skill_id`；官方域仅改自己引用的 `auto`；v7 起个人域仅 owner 可改本体的 `auto_match`（§16） |
| `POST /api/agent/skills/personal` | IK60WU 新增。body `{ content }` 为完整 SKILL.md 文本；解析 frontmatter → 校验 → 创建个人技能（§12） |
| `GET /api/agent/skills/personal/{id}` | IK60WZ 新增。owner-only 只读正文，返回重建的完整 SKILL.md 文本（§13） |
| `DELETE /api/agent/skills/personal/{id}` | IK60WZ 新增。owner-only 永久删除个人技能本体与版本行，不可逆（§13） |
| `POST /api/agent/skills/personal/format` | IK60X0 新增。body `{ content }` 为当前草稿；后台固定规则 + 受控 AI 接口返回完整替换文本（§14）；纯文本变换，不持久化、不创建资产 |

- `creative_skill_id` 入参先按 `^[a-z][a-z0-9_]{2,79}$` 校验，非法即「不存在」。

> **适用面说明**：本节端点指 Next BFF（`blue_whale_web/app/api/agent/skills/*`）——产品的
> 唯一用户可达面。Java/Python 栈已退役，其旧 `SkillController` 同路径数字 id 变体随之
> 废弃，不存在第二实现，本契约不为其保留任何行为。

## 7. 错误语义

| 场景 | 业务码 / 语义 |
|---|---|
| 注册命令指向未知、个人域或格式非法的 ID | `100100`（数据不存在，沿用现有语义） |
| 跨用户 forced 激活个人技能 / Skill 对当前用户不可见 | `100306`（BFF 统一 envelope，HTTP 200 承载业务码；语义对齐激活契约 §8 的 `CREATIVE_SKILL_UNAVAILABLE`） |
| 跨用户读/改/删个人技能（持久化层） | 0 命中，按不存在处理，不泄露存在性 |
| 个人技能名称与同用户已有技能 Name Key 冲突 | `100101`（IK60WU 新增） |
| 个人技能名称与官方技能保留名冲突（§5.2） | `100102`（IK60WU 新增） |
| 添加官方技能与同用户个人技能 Name Key 冲突（§5.4） | `100103`（IK60WX 新增） |
| AI 格式化失败：接口未配置、AI 抛错/超时或返回非合法 SKILL.md（§14） | `100104`（IK60X0 新增；前端保留原草稿，不产生部分覆盖） |

## 8. 与激活契约的关系

激活契约（2026-07-24）冻结的字段、时序与错误码语义**不变**，本契约只为其补充资产域
语义。Java/Python 栈已退役，激活的 pin 固定与按需正文读取由 Node 运行时按同一契约
接通（parity 迁移工单范围，不在本工单）。在接通之前，forced 激活的资产域/owner 边界
已在当前唯一 live 调用入口强制执行：`POST /api/projects/{id}/conversation/messages`
的消息接纳缝——携带 `forced_creative_skill_id` 时先经域/owner 校验（official 放行，
personal 仅 owner，未知/跨用户按 §7 拒绝），拒绝即不接纳消息、不创建 Run。
Node 运行时接通激活后，同一校验在其 pin 解析点重复执行（三层防御）。

## 9. 非目标

- ~~个人技能的创建、上传、AI 格式化、只读正文与复制、在线编辑端点与 UI。~~
  → 创建已由 IK60WU 落地（§12）；只读正文/复制/永久删除已由 IK60WZ 落地（§13）；
  AI 格式化已由 IK60X0 落地（§14）；在线编辑仍为非目标。
- 「我的技能」的搜索/筛选/排序控件。
- 官方技能运营后台、详情页。
- ~~`name_key` 持久化列与创建时冲突校验实现（§5 仅冻结算法）。~~
  → 已由 IK60WU 落地（§5.3）。
- Creative Skill 的 Node 运行时激活接通（pin 固定、正文按需读取）与官方目录 seed
  （`skill` 目录行与 `creative_skill` 版本化库回填）——均属 Java→Node parity 迁移工单。

## 10. 运维备注（存量库）

由退役 Java 链（V1–V20）建出的存量库已含 `creative_skill` / `creative_skill_version`
但缺两个领域列；切到 Node 栈前需一次性补列（全新环境已由 `001_baseline.sql` 含列，
无需执行）：

```sql
ALTER TABLE creative_skill
  ADD COLUMN owner_user_id BIGINT NOT NULL DEFAULT 0 COMMENT '所属用户；0=平台官方资产（IK60WS）',
  ADD COLUMN asset_domain VARCHAR(16) NOT NULL DEFAULT 'official' COMMENT '资产域 official/personal（IK60WS）',
  ADD INDEX idx_owner_domain (owner_user_id, asset_domain);
```

v2（IK60WT）存量库补列（全新环境已由 `001_baseline.sql` 含列/表，无需执行）：

```sql
ALTER TABLE skill
  ADD COLUMN category VARCHAR(32) NOT NULL DEFAULT 'other' COMMENT '目录分类 film/marketing/other（IK60WT）',
  ADD COLUMN search_keywords TEXT NULL COMMENT '后台搜索关键词，空格分隔（IK60WT）',
  ADD COLUMN name_en VARCHAR(255) NULL COMMENT '英文名（IK60WT）',
  ADD COLUMN name_zh VARCHAR(255) NULL COMMENT '中文名（IK60WT）',
  ADD COLUMN description_en TEXT NULL COMMENT '英文公开简介（IK60WT）',
  ADD COLUMN description_zh TEXT NULL COMMENT '中文公开简介（IK60WT）';

-- 存量行 backfill：zh 列继承既有单语字段
UPDATE skill SET name_zh = name, description_zh = description WHERE name_zh IS NULL;

CREATE TABLE creative_skill_activation (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  creative_skill_id VARCHAR(80) NOT NULL COMMENT '稳定技能身份',
  user_id BIGINT NOT NULL COMMENT '激活用户',
  agent_run_id VARCHAR(64) NOT NULL COMMENT '当次 AgentRun',
  skill_version INT NOT NULL DEFAULT 1 COMMENT '当次固定版本',
  activation_source VARCHAR(16) NOT NULL COMMENT 'forced/auto',
  gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_skill_user (creative_skill_id, user_id)
) COMMENT='技能成功激活埋点（IK60WT）';
```

v3（IK60WU）存量库补列（全新环境已由 `001_baseline.sql` 含列/索引，无需执行）：

```sql
ALTER TABLE creative_skill
  ADD COLUMN name_key VARCHAR(255) NULL COMMENT '归一化名称键，用于冲突判断（IK60WU）',
  ADD INDEX idx_owner_name_key (owner_user_id, name_key);
```

v7（IK60X2）存量库补列（全新环境已由 `001_baseline.sql` 含列，无需执行）：

```sql
ALTER TABLE creative_skill
  ADD COLUMN auto_match TINYINT NOT NULL DEFAULT 0 COMMENT '个人技能自动匹配开关（IK60X2）；官方行恒 0，官方 auto 在 user_skill.auto';
```

## 11. 技能库浏览扩展（v2，IK60WT）

本节冻结官方技能库浏览体验的查询语义；只涉及 library 视图与激活埋点，不改写其余章节。

### 11.1 分类

- `skill.category`：`film`（影视）| `marketing`（营销）| `other`（其他），`NOT NULL DEFAULT 'other'`。
- 每个官方技能只归属一个实际分类；请求 `category=all`（或缺省）为聚合视图，不加过滤。
- 非法 `category` 值按参数错误拒绝（BFF envelope 参数校验错误，不复用 100100）。

### 11.2 排序

- `sort`：`featured` | `most_used` | `newest`，缺省 `featured`；非法值按参数错误拒绝。
- `featured`：后台人工权重，即既有 `skill.sort_order` 升序（不依赖用户行为推断）。
- `most_used`：§11.3 的去重使用人数降序，人数相同按 `sort_order` 升序兜底。
- `newest`：`skill.gmt_create` 降序。
- 搜索（`keyword`）与分类、排序正交组合；分页沿用 offset（`pageNum`/`pageSize`）与
  `records/total/current/size` 响应壳。

### 11.3 使用人数与激活埋点

- **成功激活**：Node 消息接纳缝（§8）接纳一条携带技能激活（forced 或 auto 命中）的
  消息时，写入一行 `creative_skill_activation`（技能稳定 ID、用户、AgentRun、当次固定
  版本、激活来源）。埋点只增不改，不影响既有校验与错误语义。
  **当前落地范围**：live 缝仅有 forced 激活概念，本契约 v2 只埋 forced；auto 命中埋点
  随 Node 运行时激活接通（parity 工单）补充。pin 版本解析接通前 `skill_version` 恒记 1
  （列默认值），接通后写当次固定版本。
- **使用人数 `usage_count`**：`creative_skill_activation` 中该技能 `COUNT(DISTINCT user_id)`；
  同一用户重复激活只计一次。
- 埋点表不属于面向普通用户的读取面；普通用户只能经 library 视图的 `usage_count`
  聚合值接触该数据，单用户激活明细无任何端点暴露。

### 11.4 名称与简介的语言解析（library 视图）

- 存储：`skill` 表 `name_en/name_zh/description_en/description_zh`；既有单语
  `name/description` 视为中文源（backfill 至 `_zh` 列）。
- 请求 `lang`：`zh` | `en`，缺省 `zh`；非法值按参数错误拒绝。
- 解析规则：取请求语言列；为空（NULL 或空串）回退英文列；英文列也为空回退既有单语
  `name`/`description`。wire 字段仍叫 `name`/`description`，不暴露分列。
- 搜索 `keyword` 命中**解析语言**的 name、description 以及 `search_keywords`
  （空格分隔的后台关键词）；**绝不匹配正文 `content`**。

### 11.5 library 请求体（v2 完整形状）

```json
{
  "keyword": "可选；按钮或 Enter 触发，前端不做实时搜索",
  "category": "all | film | marketing | other，缺省 all",
  "sort": "featured | most_used | newest，缺省 featured",
  "lang": "zh | en，缺省 zh",
  "pageNum": 1,
  "pageSize": 50
}
```

## 12. 个人技能创建端点（IK60WU）

### 12.1 SKILL.md 格式

用户编写的 SKILL.md 包含 YAML frontmatter 和正文两部分：

```
---
name: 技能显示名
description: 技能简介
---

正文内容（Markdown）...
```

- frontmatter 必须以 `---` 开头和闭合，只解析 `name` 和 `description` 两个键。
- 正文为闭合 `---` 之后的内容（trim 首尾空白）。
- 三者（name / description / body）均不能为空，否则返回参数错误（400）。

### 12.2 创建端点

`POST /api/agent/skills/personal`，body：`{ "content": "<完整 SKILL.md 文本>" }`。

- 成功 → `{ code: 200, data: SkillMineView }`（`asset_domain: "personal"`，`auto: false`，
  `cover_url: null`，`source: null`）。
- 名称冲突 → `100101`；官方保留名 → `100102`（§7）。
- 格式不合法 / 字段为空 → `400`。

### 12.3 creative_skill_id 生成

- 从 name slugify（小写、空格→下划线、仅保留 `[a-z0-9_]`）。
- 全非 ASCII 或结果太短 → `s_` + base36(DJB2 hash)。
- 全局碰撞 → 追加 `_2`/`_3`…（最多 99 次）。

### 12.4 确定性封面

个人技能 `cover_url` 恒为 `null`（§3）。前端根据技能名称确定性生成渐变色背景 +
首字母图标（`generateSkillCover(name)`），同名永远一致。

### 12.5 listMine 排序变更

IK60WU 起，`POST /api/agent/skills/mine` 统一按「最近创建或添加」倒序：官方引用按
`user_skill.gmt_create` desc，个人技能按 `creative_skill.gmt_create` desc，合并后统一排序。

## 13. 个人技能只读正文与永久删除（IK60WZ）

### 13.1 只读正文端点

`GET /api/agent/skills/personal/{id}`，`{id}` 即 `creative_skill_id`。

- **仅 owner 可读**：服务端以 `asset_domain='personal' AND owner_user_id=<当前用户>`
  谓词取正文；官方域、非 owner、未知或格式非法 ID 一律 0 命中 → `100100`（§7），
  不泄露存在性。这是正文首次经面向普通用户的端点出库，**豁免仅限个人域 owner 本人**；
  §3 关于官方正文永不出库的规则不变。
- 响应 `{ code: 200, data: { content } }`：`content` 为重建的完整 SKILL.md 文本——
  frontmatter（`name` / `description`，来自 `creative_skill`）+ 正文（`body`，来自该
  技能当前生效版本 `creative_skill_version`，§12.1 格式对称）。
- 只读语义：不提供在线编辑、不提供文件下载；复制到剪贴板由浏览器端完成，不经服务端。

### 13.2 永久删除端点

`DELETE /api/agent/skills/personal/{id}`，`{id}` 即 `creative_skill_id`。

- **仅 owner 可删**：同上谓词物理删除 `creative_skill` 本体与其全部
  `creative_skill_version` 行；官方域、非 owner、未知或格式非法 ID → `100100`。
  成功 → `ok()`。
- **不可逆**：删除后正文不可查看、复制或复用；重复删除返回 `100100`（不幂等 ok）。
- 删除不追溯历史使用事实：`creative_skill_activation` 埋点只增不改（§11.3），保留的
  仅是曾使用过该技能的最小事实（稳定 ID、用户、Run、版本、来源），不含可恢复正文；
  历史 AgentRun 快照中的悬空 ID 由前端名称回退文案兜底。
- 与 `DELETE /api/agent/skills/mine/{id}` 语义互斥：后者仅逻辑删官方引用（§6），
  个人域 ID 在其上仍按不存在处理；个人技能永久删除只走本端点。

## 14. 草稿 AI 格式化（IK60X0）

`POST /api/agent/skills/personal/format`，body：`{ "content": "<当前 SKILL.md 草稿>" }`。

- **语义**：编写模式的纯文本变换工具——入草稿、出完整替换文本。**不持久化、不创建
  资产、不触碰任何 repo**；保存仍只走 `POST /api/agent/skills/personal`（§12）。
- **规则来源**：固定场景规则由后台配置（服务端常量 + env `SKILL_FORMAT_RULES` 覆盖），
  普通用户不可见、不可修改；规则与草稿分别作为 system / user 消息发给受控 AI 接口。
- **受控 AI 接口**：服务端经 new-api（OpenAI 兼容 relay）`/v1/chat/completions`，
  baseUrl / token / model 全部来自服务端 env（`NEW_API_BASE_URL` /
  `NEW_API_ROOT_ACCESS_TOKEN` / `SKILL_FORMAT_MODEL`），浏览器不可见；调用带超时，
  超时按失败处理。
- **成功** → `{ code: 200, data: { content } }`：`content` 为完整替换文本，前端整段
  替换编辑器草稿，用户可继续编辑。
- **失败**（§7 `100104`）：env 未配置、AI 抛错/超时，或返回内容不是合法 SKILL.md
  （frontmatter 缺失、`name` / `description` / 正文任一为空）。失败时前端保留原草稿
  并显示错误，不产生部分覆盖。
- 空白草稿 → 参数错误（400），不调用 AI。

## 15. 对话总结保存个人技能（IK60X1）

用户从「创建技能」页签的「总结当前对话」入口发起，由 Agent 基于当前会话的多轮内容
总结生成并直接保存 Personal Creative Skill。入口与生成语义见根 `CONTEXT.md`
「Conversation-Summarized Personal Skill」；本节冻结跨进程字段与分支语义。

### 15.1 入口与意图字段

- 「总结当前对话」入口**始终可用**，前端不按消息数或 AgentRun 状态禁用；点击后关闭
  技能面板，把**固定提示词**（前端常量，硬编码中文，文本需明确表达保存意图）预填进
  canvas `AgentChatPanel` 输入框；用户可编辑，必须手动发送，系统不得自动提交。
- 该入口只在 canvas `AgentChatPanel` 宿主提供；首页 / `/generate` 的 `AgentComposer`
  宿主不渲染此入口（该处不存在「当前对话」）。
- 预填动作同时在前端置一次性意图标记；发送时消息接纳 body 增加布尔字段
  **`skill_summarize: true`**（省略或 `false` 即普通消息）。意图靠显式字段传递，
  服务端不做提示词文本匹配；发送后前端清除标记。
- `skill_summarize` 参与 `canonicalRequest` 幂等哈希（带与不带该字段的相同文本是
  两个不同请求）。

### 15.2 执行位置与意图持久化

- 总结能力由 **agent-worker 执行**，不在 BFF 同步路径内调用 LLM。接纳时
  `skill_summarize: true` 的消息把所属 `agent_runs` 行打上总结意图标记（新列
  `skill_summarize`，新建或复用活动 Run 时置位）；Worker claim 到带标记的 Run 时
  分流到总结管道，否则走既有 runtime。
- 总结管道产出即该 Run 的 assistant 消息正文，经既有 `commitSuccess` 缝落库并广播
  `conversation.message_completed`；Run 状态机不变。
- 受控 AI 接口同 §14：new-api（OpenAI 兼容 relay）`/v1/chat/completions`，baseUrl /
  token 复用 `NEW_API_BASE_URL` / `NEW_API_ROOT_ACCESS_TOKEN`，模型来自服务端 env
  `SKILL_SUMMARIZE_MODEL`（未配置按 §15.3 失败分支处理，同 §14 `SKILL_FORMAT_MODEL`
  先例）；固定规则有内置默认常量，`SKILL_SUMMARIZE_RULES` 可覆盖，
  浏览器与普通用户不可见、不可修改；调用带超时。

### 15.3 充分性判断与保存分支

总结管道读取当前会话历史（按序的用户/assistant 消息），连后台固定规则一并交给
受控 AI 判断并产出：

- **信息不足** → 不创建技能；assistant 消息说明缺少哪些可复用信息并请求用户补充。
- **信息充分** → AI 产出 SKILL.md 草稿；服务端用 §12.1 同一解析/校验
  （frontmatter、非空 name / description / 正文）验收，非法输出按失败处理。
  校验通过即调 §12 同一 `createPersonalSkill` 服务缝保存（用户发送含保存意图的
  请求即构成创建授权，**无第二次确认**），assistant 消息返回保存成功的技能名称。
- **名称冲突**（`100101` / `100102` 语义）→ **禁止保存**，也禁止自动追加后缀落库；
  管道提议一个服务端验证可用的新名称，把草稿与提议名挂入待确认会话（§15.4），
  assistant 消息说明冲突并提议新名，等待用户确认。这是无二次确认规则的唯一例外。
  AI 提议名失败或不可用时，草稿与占用名仍挂入待确认会话，assistant 消息请用户
  直接回复一个想要的新名称保存。
- **失败**（env 未配置、AI 抛错/超时、输出非法且重试后仍非法）→ 不创建技能；
  assistant 消息返回失败说明，Run 正常完成（不走 `commitFailure`，避免重放风暴）。

### 15.4 名称冲突待确认会话

- 新持久化结构 `skill_summarize_session`：归属 conversation + user，保存 SKILL.md
  草稿、提议名称与状态（`pending_name_confirm`）；同一会话同一时刻至多一条
  pending 记录，新冲突覆盖旧记录。
- 存在 pending 记录时，该会话的下一条用户消息（无论是否带 `skill_summarize`）
  分流到总结管道的确认模式，由受控 AI 解释用户回复：
  - **确认**（可原样确认或另给新名）→ 用最终名称重试保存；再次冲突则重新提议并
    继续保持 pending；
  - **明确取消** → 关闭会话记录，assistant 消息确认未保存；
  - **无关回复** → 关闭会话记录，该消息回退给正常 runtime 处理（pass-through）。
- 确认流程全程不保存任何中间草稿到技能资产表；只有最终名称校验通过才落库。

### 15.5 边界与不变式

- 保存语义完全复用 §12：Name Key 唯一、官方保留名、跨用户隔离、确定性封面，
  不新增资产字段；「我的技能」可见性由 §12.5 排序自然保证。
- 固定规则与对话历史均不含官方技能正文；本流程不改变 §3 官方正文保密边界。
- 总结管道只写 assistant 消息与个人技能资产，不产生 CreativeSkillActivation、
  不改变 `auto` 开关、不添加官方引用。

## 16. 统一自动匹配与确定性 auto 激活（IK60X2）

本节冻结官方与个人技能统一的自动匹配开关语义，以及 Node 运行时的服务端确定性
auto 激活；不改写激活契约的字段与错误码。

### 16.1 开关语义与存储

- 官方与个人技能都可**独立**开启自动匹配，**默认关闭**；同一用户可开启多个候选。
- 官方技能：开关存 `user_skill.auto`（引用关系属性，既有），经
  `PATCH /api/agent/skills/mine/{id}` 切换（既有端点，语义不变）。
- 个人技能：开关存 `creative_skill.auto_match TINYINT NOT NULL DEFAULT 0`
  （本体属性，仅 personal 域使用；官方行恒 0）。切换走同一
  `PATCH /api/agent/skills/mine/{id}` 端点，服务端按域分流：官方域走引用更新
  （既有路径）；个人域仅 owner 可改本体 `auto_match`，谓词
  `asset_domain='personal' AND owner_user_id=<当前用户>`，0 命中一律 `100100`
  （§7，不泄露存在性）。
- mine 视图两类资产的 `auto` 均返回真实开关值（§3）。

### 16.2 auto 候选与确定性激活

- auto 候选池 = 用户开启 auto 的官方引用技能（`user_skill.auto=1`）∪ 名下开启
  `auto_match=1` 的个人技能；两类资产共用同一条 `active_version_id` 当前版本
  解析链，候选在创建 Run 时冻结（激活契约 §3）。
- **直接指定始终覆盖自动匹配**：消息携带 `forced_creative_skill_id` 时 auto
  候选为空数组（既有行为），Run 只固定 forced 激活。
- 无 forced 且候选非空时，服务端在创建 Run 的**同一事务**内确定性选择**至多一个**
  候选固定激活：取按 `creative_skill_id` 排序后的首个候选，固定
  `CreativeSkillActivation{source=auto, reason={type=agent_match, detail={matched_fields=["conversation_messages"]}}}`
  （schema 对齐激活契约 §4.3）；候选为空则不激活，正常基础生成。
- 版本事实：激活只携带稳定 ID，版本由服务端解析 `active_version_id` 当前发布
  版本并固定（官方未来运行用当前版本，历史 Run 固定当次实际版本）。
- 成功激活（forced 或 auto）均写一行 `creative_skill_activation` 埋点：
  `activation_source` 映射 `forced_use→'forced'`、`auto→'auto'`，
  `skill_version` 记当次固定版本的 major 号；埋点只增不改，使用人数
  `COUNT(DISTINCT user_id)` 与 `most_used` 排序语义不变（§11.3），同一用户
  重复激活只计一次。
- 个人技能永久删除后：其 auto 候选资格随本体行消失自然失效；历史 Run 已固定的
  激活数组不受影响；埋点保留最小事实（§13.2）。
- 运行状态对用户只显示「使用技能：技能名称」，不显示激活来源（forced/auto），
  也不写入 Agent 回复正文；auto 激活的技能名经 Run 快照 / `agent_run.created`
  事件的 `activated_creative_skill_versions` 到达前端。
