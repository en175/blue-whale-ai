# video-director 需求未完成板块说明

> **日期**: 2026-08-10 ｜ **状态**: 已定稿 ｜ **视角**: PM 需求交付进度 + 责任对齐
> **分工**: 与 [video-director-vs-backend-gap.md](./video-director-vs-backend-gap.md)(技术差异对照)互补——本文按「板块 + 责任方」列未完成项

## 0. 总览

| 层 | 定位 | 完成度 | 责任 |
|---|---|---|---|
| **A 需求规格**(IK5LR4 spec) | 产品需求定义 | **100%** | PM ✓ |
| **B 本地 cc 编排源** | PM 的**验证工具**(用 cc 提前跑通编排,止于提示词,非产品) | ~95%(骨架+断点修复done,review 格式尾巴可选) | PM(验证工具,不阻塞产品) |
| **C 后端 TS agent** | **真正的产品** | **0%** | 后端 |
| **产品上线**(A→C 跑通) | 产品交付 | **0%** | **卡在后端** |

**一句话**:**PM 的需求定义(A)已 100% 完成,产品卡在后端(C)整块没做**——不是 PM 的责任。

## 1. 责任划分

| 工作 | 谁做 | 状态 |
|---|---|---|
| A spec 讲清需求(17 票 + 6 处缺口规格) | **PM** | ✅ 100% |
| C 后端按 spec 实现全部功能(含 6 处缺口) | **后端** | 🔴 整块没做 |
| handoff 给后端(IK663F) | **PM** | ✅ 已交付 |
| B 本地 cc 编排源修订 | PM(可选) | 验证工具维护,不阻塞产品 |

## 2. 未完成板块

### 板块 A — 后端 director 整体落地(产品上线的核心阻塞,后端职责)

后端 TS agent 是通用运行时,**整套 director 行为没接入**。这是上线最大未完成板块。4 个子项:

| 子项 | 要做什么 | 后端现状 |
|---|---|---|
| **A1 director 行为注入** | 把 role/skill/编排装载进后端 agent(移植 bundle 或新机制) | 后端只读 DB Creative Skill,不装载 director |
| **A2 呈现卡型 schema** | contracts 扩 5 类卡型(Brief/分镜/拆解/交付包/复刻决策) | `plan_cards` 只有生成计划卡 |
| **A3 路由/门/阶段 action** | action 扩 director 语义(8 路由/两确认门/复刻决策门/阶段续跑) | action 仅 respond/clarify/cancel/submit_plan |
| **A4 product-api** | 建 HTTP 入口 `POST /api/projects/{id}/conversation/messages` | product-api 不存在 |

**A2/A3 涵盖 PM spec 的 6 处缺口(票9/11/13/7/12/16)的后端实现**——这些是后端在 C 层做的功能,不是 PM 改编排源。

**责任方**:后端团队(KimJohn)
**关联**:IK3UWN(TS 方案,closed)/IK2D8R(bundle,已回收)/IK3HB7(PM 设计输入,closed)
**当前门**:PM 的 handoff(IK663F)已交付,后端待据此拆 P1/P2 实施票并排期。

### 板块 B — PM 的 spec 细节确认(几乎完成)

- A spec:✅ 100% 完成,6 处缺口的规格描述够后端实现
- **唯一边界**:后端反馈 spec 哪点不够细 → PM 补 spec(不是补编排源)。目前 spec 够清,无需补

### 板块 C — 本地 cc 验证工具维护(PM,可选,不阻塞产品)

- review 自检格式优化(IK76NL 收口后的唯一本地尾巴,与板块 A 票9 相关)
- 6 处缺口在 B 层编排源的同步(可选——后端在 C 层按 spec 做了即可,B 是验证工具,不强制同步)

## 3. PM 行动项

| 优先级 | 行动 | 说明 |
|---|---|---|
| **P0** | 推后端按 IK663F handoff 拆实施票 + 排期 | 球在后端,PM 推进 |
| P1 | 后端实现期间,响应 spec 疑问(补 spec 不补代码) | 边界守住:只讲需求 |
| P2(可选) | B 层 review 格式尾巴 | 验证工具维护,想做就做 |

## 4. 依赖与阻塞

```
PM 工作:
  A spec(100%) ✅ ─── 不阻塞
  IK663F handoff ✅ ─── 不阻塞
                    │
                    ▼
后端工作(产品上线卡在这):
  板块A1(director 注入) ─┐
  板块A2(卡型 schema) ──┤
  板块A3(路由/门 action) ┼──▶ 产品上线
  板块A4(product-api) ──┘

板块C(本地验证工具) ─── 不阻塞产品(可选维护)
```

**关键**:PM 的部分done了,产品上线**只卡后端板块 A**。

## 5. 关联工单

**PM 已创建且完成**:IK5LR4(规格)/IK663F(handoff)/IK3HB7(决策面设计输入)/IK5MNJ·MAR·ODM·OXV·QDN·IK7704·IK770F(B 层已落修订)/IK6L13(本地验证)/IK76NL(断点修复,已完成)

**后端侧**:IK3UWN(KimJohn,TS 方案 closed)/IK2D8R(bundle 已回收)——板块 A 的实施票待后端从 IK663F handoff 或 IK3UWN to-spec 拆出排期

**无需 PM 开工单**:6 处缺口的后端实现工单归后端开,PM 只响应 spec 疑问
