# ADR-0039：Runtime Agent Bundle 以不可变发布快照驱动运行时

- **状态**：Accepted
- **日期**：2026-07-20
- **关联工单**：[定稿 Runtime Agent Bundle 领域契约与资源规范](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK2D8H)

> **IK3UUX 范围状态**：Bundle 与 Creative Skill 的核心语义保留；浏览器路径、恢复接口与精确合同
> 由后续实施 Spec 按最小需要定义，本文中的 Java/Python 路径只记录迁移前实现，见
> [ADR-0055](0055-prelaunch-typescript-unification-scope.md)。

## 背景

Python Agent Worker 当前把角色提示与 `generate_image` 工具硬编码在 Adapter 中；仓库
`blue-whale-agent-workspace/skill/` 又同时混放内部角色、Rules、Workflows 和用户可见创作 Skill。
数据库 `skill` 表明确服务用户 Skill 库，但正文尚未进入 Agent Runtime。若直接让 Worker 读取仓库
文件或可变数据库行，恢复中的 AgentRun 会随编辑漂移，Java、Python 与管理页也无法共享一个可发布、
可回放的边界。

同时，旧材料中的 `decision_context + 固定九分支 + /agent/turn` 与已接受的
[Conversation 命令 + Project SSE](0016-project-api-and-replayable-event-stream.md) 冲突，也把语义流程固化在
程序分支中，不符合“Agent 决定意图与流程、程序执行不可协商铁闸”的新方向。

## 决策

### 1. 运行时只消费不可变 BundleVersion

AgentDefinition 是稳定身份，BundleDraft 是可变工作区，发布原子地产生不可变 BundleVersion。
BundleVersion 固化单个 RoleDocument、有序 RuleSet、根 RuntimeSkill、ModelProfile 白名单、ToolGrant
白名单、TokenBudget 与完整 ResourceManifest。仓库内容只作导入、导出和维护源；生产环境缺失快照时
fail closed，不读取仓库或静默回退硬编码提示词。

### 2. RuntimeSkill 与 CreativeSkill 分离

RuntimeSkill 是平台内部工作流，属于 Bundle；CreativeSkill 是用户可见创作方法，继续承载
`Use` / `auto`。两者可共用 Markdown 包和渐进式披露形态，但生命周期、权限、发布与 AgentRun 固定
各自独立。现有 `skill` / `user_skill` 只迁到 CreativeSkill 模型，不能被当成 RuntimeSkill。

### 3. 发布前确定解析全部资源

资源使用稳定身份、递增 revision、POSIX 相对路径和 SHA-256 内容摘要。发布器解析并固化全部相对引用，
校验引用闭包、路径越界、缺失目标、循环依赖、Rule 冲突域和 token 预算。发布快照的 manifest 使用
规范化 JSON 摘要；运行时按 resolved resource identity 读取，不做模糊或网络解析。

### 4. AgentRun 固定行为配置与模型

创建 AgentRun 时固定 BundleVersion、manifest 摘要和 ModelProfile 版本；CreativeSkill 在首次激活时
固定具体版本。回滚只切换新 Run 的活动版本指针，既有 Run 不漂移。该固定与既有
`engine + engineVersion + adapterSchemaVersion` 固定正交，RuntimeCheckpoint 继续只保存框架不透明状态。

### 5. Bundle 只能缩小平台铁闸

Rule 可以决定角色、路由、追问、创作行为和输出偏好，ToolGrant 只允许 Agent 提议工具动作，
ModelProfile 只允许在平台模型目录内选择。User / Project 权限、内容审核、输出释放、成本、幂等、
租约、栅栏、并发、产品状态迁移、GenerationJob / Asset 生命周期、审计和公开 SSE 始终由 Java
Product API 执行，Bundle 无权覆盖或放宽。

### 6. 废弃旧语义分支与旧端点草案

不实现 `POST /api/projects/{projectId}/agent/turn` 兼容端点，也不保留
`decision_context.intent_direction / suggested_route / decision_branch` DTO。可验证的产品事实仍可由 Java
作为受控上下文提供；语义意图与流程选择改由已发布 RuntimeSkill 决定。公开命令继续使用
`POST /api/projects/{projectId}/conversation/messages`，实时与恢复继续使用 Project Snapshot / SSE。

完整字段、校验、导入导出和迁移契约见
[Runtime Agent Bundle 领域契约与资源规范](../specs/2026-07-20-runtime-agent-bundle-contract.md)。

## 考虑过的备选

- **Worker 直接读取仓库文件**：拒绝。部署制品、运行中恢复与管理页状态会形成多个权威来源。
- **原地更新活动 Bundle**：拒绝。历史 Run 无法回放，回滚也会改写既有事实。
- **继续用一个 Skill 概念承载内部与用户内容**：拒绝。权限、可见性、选择与发布语义互相冲突。
- **保留固定九分支作为兼容主流程**：拒绝。当前代码没有已发布兼容负担，保留会继续固化即将废弃的
  文档架构。
- **允许 Rule 覆盖平台限制**：拒绝。模型遵循提示不能构成权限、安全或成本边界。

## 后果

- Java 需要成为 Draft、发布快照、活动指针、资源读取与审计的权威；Python 只消费固定版本。
- Bundle 发布必须先通过静态解析与协议门，后续再叠加行为评测、隔离试运行和灰度门。
- 运行环境必须保留所有非终态 AgentRun 固定的 Bundle、ModelProfile、CreativeSkill 与 Adapter 版本；
  安全强制退役只能显式终止受影响 Run，不能让它们静默漂移。
- 旧 `decision_context`、`/agent/turn` 和整包 workspace 发布方案由后续迁移票据清理，不建立双轨兼容层。
