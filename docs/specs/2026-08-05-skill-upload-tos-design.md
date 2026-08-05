# skill 库上传 TOS 设计方案(本轮范围:链路)

- **日期**:2026-08-05
- **状态**:待评审
- **关联上下文**:IK6GXG skill 表 reseed 至 0710 版 108 条(skill_code cn01–cn108,唯一索引);33 张官方封面已上传火山 TOS(`blue-whale/assets/23/skill_image/`,public-read)
- **边界声明**:AgentChatPanel 重构(AgentRun / AgentAdvance / PlanMessage / RunCommit / Snapshot / SSE)为独立范围,**本期不碰**;前端详情 UI 由该重构侧实现,消费本链路产物。

## 1. 背景与目标

技能库 108 个 skill 已在 DB(每行含 `name` 英文展示名、`description` 中文、`content` 全文、`cover_url`、`sort_order`、`skill_code`)。前端列表(SkillPanel)已能分页展示(封面 + 英文名 + Use/auto),但详情页缺失。

**本轮交付**:skill 内容上传到火山 TOS 的**完整链路** + 前端定位详情所需的契约。最终「前端点进详情、中文标题展示」由 AgentChatPanel 重构侧消费本链路产物实现,本期**不实现任何前端 UI、不新增前端依赖**。

最终呈现(本链路 + 未来前端共同达成):
- 前端列表有图片(33 张真封面 + 75 张占位)——**已具备**
- 点进卡牌弹详情展示对应 skill——由重构侧实现,直读 TOS 对象
- 详情以中文标题(`name_cn`)展示——中文名由本链路产出,渲染由重构侧实现

## 2. 决策记录

| # | 决策点 | 选择 |
|---|---|---|
| 1 | 中文标题来源 | 新建 cn→中文名对照表 `name_cn.json` |
| 2 | 消费路径 | **前端直读 TOS**(对象 public-read);后端仅补 `skill_code` 字段、无业务逻辑改动 |
| 3 | 上传对象形态 | 每 skill 一个 JSON(`<cnXX>.json`) |
| 4 | 详情定位 key | 按 `cnXX` 命名;后端 list 响应补 `skill_code` 字段 |
| 5 | 详情展示(前端) | 由 AgentChatPanel 重构侧实现(全文 md),**本期不交付** |
| 6 | name_cn 存放 | 仓库 JSON(`docs/skills/library/name_cn.json`) |
| 7 | 详情导航(前端) | 由重构侧实现,**本期不交付** |
| 8 | md 渲染(前端) | 由重构侧定(react-markdown 或复用),**本期不新增依赖** |
| 9 | content 处理 | 去 frontmatter,仅存正文 |
| 10 | 中文名准备 | AI 初拟草稿,用户审核 |

> 注:调研确认 `creative_skill` 表在测试库**不存在**,故 list 响应的 `creative_skill_id` 恒为 null,不能用作详情定位 key;`skill_code`(cnXX)是唯一稳定定位字段(DB 有唯一索引,与 raw 库编号绑定,重 seed 不漂移)。

## 3. 架构与数据流

```
raw/cnXX-*.md ×108 ──┐
name_cn.json ────────┤──► upload-skill-json.cjs ──► 火山 TOS
covers(33 张,已传) ──┘    (提取→组装→校验→上传→HEAD 回验)   blue-whale/assets/23/skill/<cnXX>.json (public-read)
        │
        │ 列表:现有 DB API(本期补 skill_code)
        ▼
未来前端(AgentChatPanel 重构侧):按 skill_code 拼 URL 直读 TOS 详情对象
```

- **本期改动**只落在三处:`name_cn.json`(数据)、`upload-skill-json.cjs`(离线脚本,`ik6cuz-scripts/`)、后端 `skill-repo.ts`(补 `skill_code`)。**不碰前端、不碰 AgentChatPanel。**
- 前端详情展示与 react-markdown 等均在重构侧决策,不在本期。

## 4. 上传对象 schema

每个 skill 一个对象,key = `blue-whale/assets/23/skill/<cnXX>.json`。

```json
{
  "skill_code": "cn01",
  "name_cn": "电商 TVC 广告",
  "name": "Tvc Product Ad",
  "description": "使用此技能将电商产品视频结构化为精致、高端的电视广告（TVC）。…",
  "content": "## 说明\n\n将此格式作为电商产品视频分镜和脚本的创意指导。…",
  "sort_order": 1,
  "cover_url": "https://<bucket>.<endpoint>/blue-whale/assets/23/skill_image/cn01-tvc-product-ad.png"
}
```

字段说明:

| 字段 | 来源 | 说明 |
|---|---|---|
| `skill_code` | raw 文件名前缀 | cn01–cn108 |
| `name_cn` | `name_cn.json` | 中文标题(详情页主标题),用户审核 |
| `name` | frontmatter `name` / DB 展示名 | 英文注册名/展示名 |
| `description` | frontmatter `description` | 中文描述 |
| `content` | raw 文件**正文**(去 frontmatter) | 详情页全文 markdown 渲染源 |
| `sort_order` | cn 编号 | 1–108 |
| `cover_url` | 封面映射 | 33 张有值,75 张 `null`(前端走占位图) |

### 4.1 消费契约(供未来前端/重构侧)

- 详情 URL = `SKILL_JSON_BASE + skill_code + ".json"`,其中 `SKILL_JSON_BASE = "https://<bucket>.<endpoint>/blue-whale/assets/23/skill/"`,与封面存储同域同路径前缀。
- 列表 API 本期补 `skill_code` 字段,前端据此拼 URL;`SKILL_JSON_BASE` 由重构侧定义,须与上传脚本 key 前缀一致。
- 本期不实现任何前端取值逻辑。

## 5. 组件(本期 3 块)

### 5.1 `name_cn.json`(新增,仓库 `docs/skills/library/name_cn.json`)

- 结构:`{ "cn01": "电商 TVC 广告", …, "cn108": "…" }`,108 条。
- 提供方式:AI 基于 description + `_index.md` 分类初拟草稿,用户审核修订。
- 校验:上传脚本启动时校验 key 覆盖 cn01–cn108 且值非空,缺/错即中止。

### 5.2 `upload-skill-json.cjs`(新增,`ik6cuz-scripts/`)

复用 `upload-skill-covers.cjs` 的既有 TOS 模式:

- 凭证从 `../new/.env` 读 `VOLC_*`(access key / secret / endpoint / bucket / region),不打印。
- `@volcengine/tos-sdk`,`putObjectFromFile` + `acl: "public-read"` + `contentType: "application/json"`。
- `--dry-run` 只列目标不传;正式上传后逐个 HEAD 回验 `content-length`;失败重试 1 次,结果写 CSV。
- 输入:raw 108 篇 + `name_cn.json` + `upload-covers-result.csv`(封面 URL 映射,无→null)。
- 内置一致性校验:108 条齐全、sort_order 1–108 唯一、name_cn 非空、封面分布(33/75)。

### 5.3 后端补 `skill_code`(改动 `packages/persistence/src/skill-repo.ts`)

- `SkillLibraryView`、`SkillMineView` 接口各加 `skill_code: string`。
- `listLibrary` select 加 `skill_code: true`;`listMine` 的 skill 快照 select 加 `skill_code: true`,并把 `skill_code` 透出到 records。
- 影响面:2 个 select + 2 个接口类型;无 schema 变更(`skill_code` 已在 DB)。
- 不改 list 的过滤/排序语义,不影响前端既有字段。

## 6. 错误处理

| 环节 | 失败 | 处理 |
|---|---|---|
| 上传 | putObjectFromFile 异常 | 重试 1 次,失败行写 CSV |
| 回验 | HEAD content-length 不符 | 计入失败,写 CSV,脚本 exit 1 |
| 校验 | name_cn 缺失/格式错 | 启动即中止,不进入上传 |

(前端详情降级/占位等由重构侧处理,不在本期。)

## 7. 测试与验收

1. 脚本 `--dry-run`:输出 108 个 key + URL,零报错。
2. 正式上传:HEAD 回验 **108/108** 成功。
3. 后端:`tsc -b` 通过;测试库 dev 列表响应含 `skill_code`。
4. 抽样:浏览器抓取 2–3 个 `<cnXX>.json` 对象,确认字段完整、content 为正文(无 frontmatter)、cover_url 与封面一致。
5. 前端消费验收(点详情/中文标题渲染)交由 AgentChatPanel 重构侧,不在本期验收。

## 8. 待办与风险

- ⏳ **`name_cn.json` 108 个中文名**:AI 初拟草稿 → 用户审核(唯一内容阻塞项)。
- 封面覆盖 33/108,其余 75 张 `cover_url=null`(前端占位图,已具备)。
- 对象存储域名/桶变更时,`SKILL_JSON_BASE`(重构侧)与上传脚本 key 前缀须同源同步。
- 未来前端必须按 §4.1 契约消费;若重构侧改 key 前缀,需与上传脚本同步。
- 后端 `skill_code` 为新增响应字段,属可写代码改动,实施时按项目规则走 task worktree。
