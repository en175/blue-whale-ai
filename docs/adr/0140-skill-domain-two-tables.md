# ADR-0140：技能域收敛为两张表，身份与版本并入目录

- **状态**：已采纳
- **日期**：2026-10-30
- **决策者**：lixq
- **关联**：IKLR13（技能体系）、[ADR-0135](0135-catalog-material-content-prefixes.md)

## 背景

技能域此前有四张表：`catalog_skills`（官方目录，含正文与橱窗字段）、`catalog_creative_skills`（官方与个人共用的「身份」）、`catalog_creative_skill_versions`（正文版本）、`user_skills`（用户对官方技能的收藏）。

核对生产代码后确认：

1. **身份表没有维护入口**。管理端只操作 `catalog_skills`；身份表只有回填创建官方行和用户创建/删除个人行，没有更新通路。官方行一旦回填就与目录脱节。
2. **版本表从未被使用**。写入只有 `1.0.0` 的插入与删除，没有发布新版本的通路；其服务的运行 pin 依赖的 `agent_runs` 已由 IKRJ9P 退役。
3. **由此产生缺陷**：目录改名/改简介不同步到身份表；官方技能下架后解析仍返回正文（IKRJP7）；目录行删除后身份行成为无人清理的孤儿。

Agent 端实际行为是：按 `creative_skill_id` 取「此刻的正文」，不指定版本。

## 决策

1. **只改造现有两张表，不新建表**：
   - `catalog_skills` 增加三列：`creative_skill_id`（对外稳定身份）、`owner_user_id`（0 = 官方，其余 = 创建者）、`name_key`（归一化名称）。
   - `user_skills` 结构不变。
2. **正文继续存在 `catalog_skills.content`**。个人技能的正文也写入该列；不新增 `body` 列。
3. **上下架继续使用 `is_delete`**（0 在架、1 下架）。不新增 `is_active`。
4. **个人技能的归属由 `owner_user_id` 表达**：个人技能不进 `user_skills`，凭 ownership 出现在「我的技能」。`user_skills` 只表达「用户收藏了哪条官方技能」，两者是不同关系，不可互相替代。
5. **同名约束改为按 owner**：删除全局 `uk_name`，新增 `(owner_user_id, name_key)` 唯一索引；官方名全局唯一，个人名按用户唯一。应用层在个人创建与管理端改名时查重。
6. **解析按单表读取**：官方技能要求 `owner_user_id = 0 AND is_delete = 0`；个人技能要求 `owner_user_id = 当前用户`。原有缺陷 IKRJP7 由该条件自然覆盖。
7. **删除 `catalog_creative_skills` 与 `catalog_creative_skill_versions`**：身份数据并入 `catalog_skills`，个人正文取当前版本 body；不保留版本历史。
8. **管理端补齐内容维护**：详情、编辑（名称/简介/正文/分类/排序/封面）、上下架；全部限定 `owner_user_id = 0`。

## 后果

- **破坏性发布**：迁移后旧镜像读不到两张旧表，数据库与后端镜像必须同窗口上线；迁移前备份，回滚只能靠备份。
- **迁移以数据搬运为主**：官方行按 `source_skill_id` 回填 `creative_skill_id` 与 `name_key`；个人行与无目录的官方身份行插入新行；正文优先取版本 body，目录无正文时回落到既有正文。迁移会输出 `skills_without_content` 计数，执行者需记录。
- **名称唯一性从库级全局降为按 owner**：绕过管理端直接写库仍可能产生官方重名。
- **版本历史不再存在**：需要按版本复现时，另立工单重新引入。
- **C 端接口与字段不变**：`creative_skill_id` 直接来自新列；双语名称、简介、搜索词、分类、排序全部保留；使用人数继续来自现有埋点表。
- **Agent 契约不变**：请求与响应字段不变；迁移沿用现有 `creative_skill_id`，会话中保存的 id 继续可解析。
- `001_baseline.sql` 与 `002_seed.sql` 保持时间点快照，不回改；worker-java 测试 schema 同步为两表结构。

## 被否方案

- **合并为一张新表并新增 body/digest 等列**：会引入与 `content` 重复的正文列，且表数并未减少。
- **拆成「官方技能表 + 个人技能表 + 收藏表」**：每张表语义单一，但列表与解析都要 union，运营与个人各写一套 CRUD；当前规模下复杂度高于收益。
- **保留四张表并给身份表补维护入口**：等于为一个没有消费者的版本机制再造一套发布流程。
