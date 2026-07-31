---
status: Accepted
date: 2026-07-31
supersedes:
  - 0004
---

# ADR-0063：引入 release 分支线，建立「研发 → 发布」两层分支模型

## 背景

ADR-0004 原定 trunk-based 单一长青分支 `master`，明确「不加 `release/`（无发布分支线）」。该模型在 AI Agent 协作场景下足够轻量，但在 2026-07-31 暴露了实际痛点：

- **测试服与生产服跑什么版本不可知**：所有部署走 `docker run` + 镜像 tag `:latest`，零 commit 绑定（详见 2026-07-31 部署调研）。当 `master` 合并后部署滞后，出现「代码合并了但测试服没更新」的严重事故（IK50GB 的 `/api/token/identity` 端点缺失导致画布全量 502）。
- **没有「冻结的发布基线」**：`master` 持续前进，生产部署无法锚定一个「已验证、不再接受新功能」的稳定点，发版与回归边界模糊。

本 ADR 引入 `release/*` 分支线作为**已验证的发布基线**，把「正在研发的代码（master）」与「将要 / 已经上线的代码（release）」分开。**ADR-0004 中「不加 release/」的条款被本 ADR 取代**，其余分支命名约束（前缀白名单、合并即删、保护 master）不变。

## 决策

引入 `release/*` 分支线，建立两层分支模型：

```
master      —— 研发集成分支，所有 feature/fix PR 合入此处，持续前进
release/*   —— 发布基线，从 master 拉出，只接受 bugfix，供测试服 / 生产部署锚定
```

### 分支命名

- `release/<版本号或环境>`，如 `release/prod`、`release/2026-08`。
- 加入 ADR-0004 分支前缀白名单：`{feature, fix, hotfix, docs, chore, release}`。
- `release/*` 是**长青分支**，**不遵循「合并即删」**（与 feature/fix 不同）。

### release 分支的生命周期

1. **创建**：从 `master` 某个已验证的 commit 拉出 `release/*`。首个 `release/prod` 于 2026-07-31 从 `origin/master`（`67146fe2`）创建。
2. **演进**：`release/*` **只接受 bugfix / 热修复**，不接受新功能。bugfix 通过 cherry-pick 从 `master` 同步，或在 release 分支上直接修后**必须回合（backport）到 master**。
3. **部署锚定**：测试服与生产服的部署**优先从 `release/*` 拉取**，不再直接锚定 `master`。部署镜像必须绑定具体 commit（见「与镜像 tag 的关系」）。
4. **终止**：当一个 release 版本彻底退役（无生产流量）时，删除对应 `release/*`。

### 与现有工作流的关系

- **ADR-0004**：「不加 release/」条款被取代；其余约束（master 保护、禁直推、合并即删 feature/fix）不变。
- **ADR-0010**：本地 `master` 仍是用户集成区；`release/*` 同样通过 PR 合入，不直推。
- **ADR-0003**：所有进 `release/*` 的改动走「分支 → PR → 服务端 merge」，与 master 一致。

## 与镜像 tag 的关系（强约束）

**`release/*` 分支线必须配合「镜像 tag 绑定 commit」才有效。** 仅靠分支不够——若部署仍用 `:latest`，无法回答「release/prod 当前跑哪个 commit」。

因此本 ADR 同时规定（配合后续「镜像版本与部署溯源」ADR）：

- 每次 `release/*` 上的部署，镜像 tag 必须含 commit short SHA（如 `:release-prod-67146fe2`）。
- 部署完成后，在对应 Gitee 工单或部署日志记录「部署了哪个 commit」。
- **禁止对 `release/*` 使用 `:latest` 可变 tag 做生产部署。**

## 与「环境」的对应

- **测试服**：默认部署 `release/*`（或 master，取决于验证阶段），但镜像必须绑 commit。
- **生产服**：只部署 `release/*`，且必须经过测试服验证。
- 详见后续「环境拓扑」ADR（待建）。

## 后果

**正向：**
- 发布有了冻结基线，生产部署可锚定、可回溯。
- master 可以继续往前走而不影响正在发布的版本。
- 配合镜像 commit tag，彻底解决「不知道跑什么版本」。

**负向 / 成本：**
- 多一条分支线需要维护：release 的 bugfix 必须回合 master，否则两边分叉。
- 团队需熟悉「feature → master → cherry-pick 到 release」的流程。
- 引入「release bugfix 未回合」导致 master/release 分叉的风险，需 CI 或人工巡检。

## 待办（本 ADR 之外）

- [ ] 更新 ADR-0004 状态为 Superseded（指向本 ADR），保留原文。
- [ ] 更新 `CLAUDE.md` 与 `.claude/rules/` 中分支前缀白名单，加入 `release/`。
- [ ] 新建 ADR：镜像版本与部署溯源（commit tag 绑定规则）。
- [ ] 新建 ADR：测试 / 生产环境拓扑。

## 参考

- [ADR-0004 分支命名规范](./0004-branch-naming.md)（被本 ADR 部分取代）
- [ADR-0003 禁止直推 master](./0003-no-direct-push-to-master.md)
- [ADR-0010 本地 master 是用户集成区](./0010-local-master-is-user-integration-zone.md)
- 2026-07-31 部署调研（`:latest` 无 commit 绑定、测试服 docker run 现状）
