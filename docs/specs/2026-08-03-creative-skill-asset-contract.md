# Creative Skill 资产契约（官方/个人领域边界、公开元数据与稳定身份）

- **状态**：Accepted for implementation
- **契约版本**：3（v2 纳入 IK60WT 技能库浏览扩展：分类/排序/使用人数/i18n，见 §11；v3 纳入 IK60WX 添加官方技能的同名冲突语义，见 §5.2/§6/§7）
- **关联工单**：[01 — 建立官方与个人 Creative Skill 安全边界](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60WS)、[02 — 一比一还原官方技能库浏览体验](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60WT)、[05 — 添加官方技能并统一“我的技能”资产视图](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK60WX)
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
| `auto` | — | ✓ | 引用关系属性；个人技能行恒 `false`（个人自动匹配归后续工单） |

- **禁止字段**：`content`、`body`、`prompt`、内部规则、版本号、digest、自增主键及任何
  未列入上表的字段，不得出现在面向普通用户的技能响应中。BFF handler 必须显式 pick
  白名单字段，不得原样透传上游对象。
- 普通用户无任何官方技能详情、正文或复制接口；本契约不新增此类端点。

## 4. 所有权与可见性矩阵

| 操作 | 官方技能 | 个人技能 |
|---|---|---|
| 读公开元数据（library/mine 列表） | 所有用户 | 仅 owner（经 mine 并集返回） |
| 添加/移除引用、设 auto | 所有用户（自己的引用） | 不适用（无引用概念） |
| 读正文 / 复制 | 任何用户都不可（仅受信任运行时按 pin 读取） | 仅 owner（只读端点归创建工单，本文不定义） |
| 修改 / 删除 | 任何用户都不可（运营通道不在本文范围） | 仅 owner；跨用户一律按不存在处理 |
| 调用（forced 激活） | 所有用户 | 仅 owner；跨用户按 `CREATIVE_SKILL_UNAVAILABLE` 拒绝 |
| auto 候选 | `user_skill.auto` 派生，仅官方域 | 不进入候选（后续工单评估） |

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
| `PATCH /api/agent/skills/mine/{id}` | `{id}` 语义改为 `creative_skill_id`；仅改自己引用的 `auto` |
| `POST /api/agent/skills/personal` | IK60WU 新增。body `{ content }` 为完整 SKILL.md 文本；解析 frontmatter → 校验 → 创建个人技能（§12） |

- `creative_skill_id` 入参先按 `^[a-z][a-z0-9_]{2,79}$` 校验，非法即「不存在」。
- 个人技能只读正文、删除端点不在本契约范围（后续工单定义）。

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
  → 创建已由 IK60WU 落地（§12）；只读正文/复制/在线编辑归后续工单。
- 「我的技能」的搜索/筛选/排序控件；个人技能 auto 候选。
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
