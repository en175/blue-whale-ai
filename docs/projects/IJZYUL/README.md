# IJZYUL — 前端架构补全计划（vertical slices）

> **工单**：[IJZYUL — [ARCH] 前端架构补全计划（vertical slices）](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYUL)
> **类型**：父 issue（program-level）
> **状态**：进行中（5/8 子 issue 完成 / 1 已撤回 / 2 待办）
> **文档存放约定**：本目录每个子 issue 一个 `.md` 文件，子 issue 完成时与该子 issue 的 feature 分支提交一起入库；后续若无法跟随原分支（如 PR 已合并的追溯入库），落到 `chore/docs-ijzyul-progress` 集中补救。

---

## 目标

梳理 `blue_whale_web` 当前架构缺口，按 vertical slice 拆出可独立领取的子 issue。每个子 issue 是一个 tracer-bullet，端到端可验证。

## 背景

当前为 DEMO 阶段纯客户端 SPA，已实现 Canvas 工作台（节点编排 + AgentChatPanel + BottomDock）和本地轻量 auth（AuthProvider / authStorage）。对照生产级 React 项目，缺：

- 路由兜底 UI
- prettier / pre-commit 守门
- 巨型文件（AgentComposer 78KB、SkillPanel 60KB）
- 领域类型顶层共享
- Canvas 状态 hooks 抽离
- API 客户端骨架
- E2E 测试

按 CLAUDE.md "Simplicity First"，**不补**：全局状态库、i18n、PWA、Storybook（DESIGN.md 设计系统先沉淀一阶段再考虑可视化）。

## 子 issue 依赖图

```
#1 error/loading/not-found      ─┐
#2 prettier + pre-commit        ─┤
#3 退役 AgentComposer           ─┤
#4 拆 SkillPanel                 ─┼─ 无依赖，可并行
#5 顶层领域类型                  ─┤
#7 API 客户端骨架                ─┤
#8 Playwright E2E               ─┤
#6 useProject hooks 抽离         ─┴─ 阻塞 #5
```

## 子 issue 进度表

| # | 工单 | 标题 | 状态 | 分支 | commit | PR | 文档 |
|---|---|---|---|---|---|---|---|
| 1 | IJZYVA | 新增路由兜底 UI | ✅ 已合 | `feature/IJZYVA-新增路由兜底UI` | `fb9ea33` | [#35](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/pulls/35) | [IJZYVA.md](./IJZYVA.md) |
| 2 | IJZYVJ | prettier + pre-commit 守门 | ✅ 已合 | `feature/IJZYVJ-补全前端提交守门` | `9c01ccf` | [#38](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/pulls/38) | [IJZYVJ.md](./IJZYVJ.md) |
| 3 | IJZYVK | 退役 AgentComposer | ❌ 已撤回（wontfix） | — | — | — | [IJZYVK.md](./IJZYVK.md) |
| 4 | IJZYVO | 拆 SkillPanel 巨型组件 | ✅ 已合 | `feature/IJZYVO-拆SkillPanel组件` | `fe2196c` | [#40](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/pulls/40) | [IJZYVO.md](./IJZYVO.md) |
| 5 | IJZYVP / 待定 | 顶层领域类型 | ⏳ 待办 | — | — | — | _待开_ |
| 6 | IJZYxx | useProject hooks 抽离 | ⏳ 待办（阻塞 #5） | — | — | — | _待开_ |
| 7 | IJZYxx | API 客户端骨架 | ⏳ 待办 | — | — | — | _待开_ |
| 8 | IJZYxx | Playwright E2E | ⏳ 待办 | — | — | — | _待开_ |

## 父 issue 验收总览

- [x] 9 条子 issue（含本父 issue）全部 `ready-for-agent` 标签到位
- [x] IJZYVA / IJZYVJ / IJZYVO 端到端验证通过（手动 + 测试 + lint）
- [x] IJZYVK 撤回后打 `wontfix` 标签，state=closed
- [ ] IJZYVP（顶层领域类型）/ IJZYVQ（useProject hooks）/ IJZYVR（API 客户端）/ IJZYVS（E2E）4 条子 issue 全部完成
- [x] build / lint / test 三件套持续绿
- [x] 不引入与 CLAUDE.md 冲突的全局状态库 / i18n / PWA / Storybook

## 提交约定

- **每个子 issue 的 docs 记录**：`docs/projects/IJZYUL/IJZYxx.md`
- **新子 issue 流程**：子 issue feature 分支的 commit 流中包含两段 —— 实现 commit + docs commit；二者一起 push、一起 PR
- **追溯入库**：若子 issue PR 已合（如 IJZYVA/IJZYVJ/IJZYVO），docs 记录在 `chore/docs-ijzyul-progress` 分支补救 commit
- **状态字段**：`✅ 已合` / `🔄 进行中` / `⏳ 待办` / `❌ 已撤回` / `⚠️ 阻塞`