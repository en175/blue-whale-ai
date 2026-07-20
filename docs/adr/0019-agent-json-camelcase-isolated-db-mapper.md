# ADR-0019：agent HTTP JSON 统一 camelCase，DB JSON 列隔离 ObjectMapper

- **状态**：Accepted
- **日期**：2026-07-14

## 背景

agent-service 曾在 `application.yml` 配 `spring.jackson.property-naming-strategy: SNAKE_CASE`，使 HTTP
响应字段为 snake_case（`cover_url`/`job_id`/`model_id` 等）。初衷是让前端 snake_case 请求字段映射到后端
camelCase 实体，并让 `MybatisJacksonConfig` 复用 Spring 的 ObjectMapper 给 `JacksonTypeHandler`，统一
DB JSON 列（snake_case）↔ 实体（camelCase）的双向映射。

但这带来两个问题：

1. **违反规范**：CLAUDE.md 后端规范明确「HTTP 对外 JSON camelCase，未配 SNAKE_CASE」。全局 SNAKE_CASE
   让 agent 所有 HTTP 响应变成 snake_case，与规范冲突。
2. **前端不一致 + bug**：前端 `skills.ts` 按 camelCase 期望（`coverUrl`/`skillId`），而
   `generation.ts`/`jobs.ts` 按 snake_case 期望（`job_id`/`model_id`）。agent 响应实际是 snake_case，
   导致 `skills.ts` 字段不匹配——`skill.coverUrl` 为 `undefined`，`SkillCover` 走 `placehold.co` 占位图，
   技能封面不显示。

## 决策

### 1. agent HTTP JSON 统一 camelCase

删 `application.yml` 的 `spring.jackson.property-naming-strategy: SNAKE_CASE`，回 Spring 默认 camelCase。
HTTP 响应/请求字段全部 camelCase（`coverUrl`/`jobId`/`modelId`），合规 CLAUDE.md，对齐前端 `skills.ts`
既有期望。

### 2. DB JSON 列用独立 SNAKE_CASE ObjectMapper（隔离）

DB 的 JSON 列（`GenerationModelCapability` 4 字段 + `GenerationJob` 3 字段：
`input`/`outputAssetIds`/`error` 等）仍是 snake_case，需要 snake↔camel 映射。`MybatisJacksonConfig`
不再复用 Spring 容器的 ObjectMapper，改为**自建**一个 SNAKE_CASE 的 `JsonMapper`，`setObjectMapper` 给
`JacksonTypeHandler`。HTTP 的 ObjectMapper（camelCase）与 DB JSON 的 ObjectMapper（SNAKE_CASE）隔离，
互不污染。

### 3. 普通列靠 MyBatis-Plus map-underscore

普通列（`coverUrl`↔`cover_url` 列）的映射由 MyBatis-Plus `map-underscore-to-camel-case: true`（已配）负责，
独立于 Jackson。去掉 Jackson SNAKE_CASE 不影响普通列映射，**不加 `@TableField` 显式标注**（默认已自动映射）。

### 4. 前端统一 camelCase

`skills.ts` 本就 camelCase；`generation.ts`/`jobs.ts`/`dto.ts`/`assets.ts`/`canvas.ts` 及
`canvas/page.tsx`/`generate/page.tsx` 消费页的 snake_case 字段改 camelCase。前端字段命名全局统一。

## 影响

- **后端**：`application.yml`（删 SNAKE_CASE）、`MybatisJacksonConfig`（B1 独立 ObjectMapper）。
- **前端**：7 个文件 snake→camel（类型定义 + 请求 payload + 响应消费）。
- **不变**：
  - webhook `/api/webhooks/ark`（`Map<String,Object>` 接收，不解析字段，无 DTO 映射）；
  - 普通列映射（map-underscore-to-camel-case）；
  - DB JSON 列数据（仍 snake_case，由独立 ObjectMapper 映射，不迁移数据）。

## 后果

agent HTTP 契约 camelCase，合规 CLAUDE.md；前端字段命名统一 camelCase（消除 skills vs generation/jobs 的
不一致）；DB JSON 列映射隔离，后续调整 HTTP 策略不再波及 DB JSON 反序列化。
