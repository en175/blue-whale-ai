# video-director-local 编排与呈现规格 vs 后端 Agent 实现 — 差异分析

> **日期**: 2026-08-10 ｜ **状态**: 已定稿 ｜ **用途**: 澄清「PM 提的编排/呈现需求」与「后端 TS agent 当前实现」的真实差异,供测试同学与后端对齐
> **需求来源**: PM 创建的 gitee 工单(IK5LR4 族等) ｜ **对照对象**: 本仓后端 TS agent(apps/agent-worker + packages/)
> **配套文档**: [video-director-unfinished-blocks.md](./video-director-unfinished-blocks.md)(未完成板块 + 责任方)

## 0. 一句话结论

后端 TS agent 是「通用运行时」(能出卡/追问/真生成,基础设施生产级),但**整套视频导演 director 行为(路由/确认门/决策门/呈现卡型)没接入后端**——PM 的需求规格(IK5LR4)是为后端平台写的,后端目前跑不起来。

## 1. 范围与口径(最容易混,先讲清)

存在三层,务必分清:

| 层 | 是什么 | 状态 |
|---|---|---|
| **A. PM 需求规格**(IK5LR4) | 视频导演呈现交互规格,17 票,**平台真生成语境** | spec 已交付,这是「后端要实现的目标」 |
| **B. 本地 cc 编排源**(video-director-local) | PM 把 A 在本地 cc 做了**止于提示词**的落地验证版 | 100% 文档完成;IK6L13 已本地实跑;**IK76NL 10 断点已修复收口(2026-08-10)** |
| **C. 后端 TS agent**(apps/agent-worker) | 通用 agent 运行时 | **没有 director 行为**,A 落不了地 |

**本报告差异 = A(PM 需求) vs C(后端现状)**。IK6L13「验证通过」+ IK76NL「修复收口」验证的都是 B,**不是 C**。

**差异档**:🔴 后端无对应概念(要新建) / 🟡 后端有通用机制无 director 语义(要适配) / 🟢 后端已覆盖或归前端

**排除**:IK76NL(B 层断点修复,**已完成**)。IK2D8R/IK3UWN(KimJohn 工程工单,仅作背景,见 §8)。

## 2. 后端现状基线(差异参照系)

**后端 agent 有的**(通用运行时,生产级):

- `respond` 流式文本 / `clarify` 通用追问(带 question+stage) / `submit_plan`+`plan_cards` **生成计划卡**(确认后 generation-worker 调 provider 真生成) / `cancel`
- `read-asset-tool`(读素材)、`write-plan-cards-tool`(写卡)
- DB Creative Skill 表(108 条)作为 skill 来源
- lease/fence/幂等/provider 审计(基础设施很强)

**后端 agent 没有的**:director 意图路由、确认门、决策门、阶段续跑、呈现卡型(Brief/分镜/拆解/交付包)。

## 3. 编排行为差异(agent 怎么决策)

| 你的需求 | 工单(PM 创建) | 后端现状 | 差异 |
|---|---|---|---|
| 8 意图路由分发 | IK6L13(T3/IK6L2L)、IK5LR4 | 无 director 路由,全靠模型自由判断 | 🔴 |
| full-canvas 五阶段+两确认门 | IK5ODM、IK5LR4票3、IK663F | 无阶段/确认门,clarify 是通用追问无门语义 | 🔴 |
| 复刻决策门(独立卡,只选复刻度) | IK5LR4票13、IK663F | 无决策门概念 | 🔴 |
| 阶段自动续跑(4→5) | IK76NL F2(B4) **已修(B)** | 后端 C 无阶段概念 | 🔴(C) |
| **止于提示词交付包** | IK6L13 红线 | 后端 `submit_plan` 是**真生成**——方向相反 | 🟡 方向冲突 |

> IK76NL F2(阶段续跑)修复落在 B(本地cc markdown),**对 C 后端无效**——后端仍无阶段概念。

## 4. 呈现卡差异(17 票,A 的核心)

后端 `plan_cards` = **生成计划卡**(执行生成),**不是呈现卡**。PM 的 5 类呈现卡后端无对应卡型 schema。

| 票 | 呈现卡/点 | 工单(PM 创建) | 后端差异 |
|---|---|---|---|
| 5 | Brief 摘要卡(7字段)+提问 | IK5LR4、IK663F | 🔴 无 Brief 卡型 |
| 7 | 分镜表卡(5列/多卡分组) | IK5LR4、IK5ODM、IK663F | 🔴 无分镜卡型 |
| 8 | 提示词交付包卡(5区) | IK5LR4、IK5MAR、IK663F | 🔴 无交付包卡型 |
| 11 | 拆解报告卡(5模块+beats) | IK5LR4、IK663F | 🔴 无拆解卡型 |
| 13 | 复刻决策卡(独立) | IK5LR4、IK663F | 🔴 无决策卡型 |
| 4 | visible_reasoning 思考摘要 | IK5LR4、IK3HBK | 🟡 有 reasoningSummary 字段,折叠渲染归前端 |
| 9 | 审核摘要(流式非卡) | IK5LR4、IK3HB7 | 🟡 respond 流式可承载,无 director 语义 |
| 12 | 视频理解过程(流式非卡) | IK5LR4 | 🟡 respond 流式可承载 |
| 1 | 卡片 vs 流式出现时机总则 | IK5LR4 | 🟡 respond/submit_plan 二分有,无卡型区分 |
| 2 | 确认与追问 UI(自然语言) | IK5LR4、IK5MNJ | 🟡 clarify 通用有,无两确认门语义 |
| 6 | Skill 分歧厘清(多轮) | IK5LR4、IK5OXV | 🟡 clarify 通用,无 Skill 分歧语义 |
| 14 | 复刻素材绑定 | IK5LR4 | 🟡 靠模型组织,无绑定卡型 |
| 16 | 局部改镜/回退/Stop | IK5LR4 | 🟡 局部改靠对话往返,灰显/Stop 归前端 |
| 10 | 直生轻量交付 | IK5LR4 | 🟡 后端走 submit_plan 真生成(A 本就是平台语境) |
| 15 | 多模态输入/@图片N | IK5LR4 | 🟢 read-asset-tool 有,画布展示归前端 |
| 17 | 一键复制 | IK5LR4 | 🟢 纯前端 |

**统计**:🔴 后端无概念 5 票(5/7/8/11/13) / 🟡 有通用无 director 语义 9 票(1/2/4/6/9/10/12/14/16) / 🟢 归前端 2 票(15/17)。

## 5. 编排源修订(6 票,改的是 B 的 agent 指令)

修订改的是 **B(本地cc编排源)的 markdown 指令**,IK76NL 已把相关断点修复收口(B 干净)。但对后端 C 仍无效果——后端不装载这套 skill。

| 修订 | 工单(PM 创建) | B 层状态 | 对后端 C |
|---|---|---|---|
| 删「每轮3问」上限 | IK5MNJ | ✅ 已落 B | N/A |
| 生图提示词从交付包独立 | IK5MAR | ✅ 已落 B | 🔴 C 无交付包概念 |
| storyboard 拆串行两确认门 | IK5ODM | ✅ 已落 B | 🔴 C 无确认门 |
| skill-selector 二选一→多轮 | IK5OXV | ✅ 已落 B | 🟡 C 靠模型+DB skill |
| seedance 三段论→每镜独立 | IK5QDN | ✅ 已落 B | 🔴 C 无提示词结构 |
| 版权轻提示/呈现透明度 | IK7704(B6)、IK770F(B7) | ✅ 已落 B(IK76NL 收口) | 🔴 C 无 |

## 6. 根本差异(3 类,给后端看)

1. **整套 director 行为注入缺失**(最大):后端 TS agent 不装载 director 的 role/skill/编排;runtime bundle(旧 Python worker,他仓)没移植到 TS → 后端不知道怎么做视频导演。
2. **呈现卡型 schema 缺失**:后端 `plan_cards` 是生成计划卡(执行生成),≠ 呈现卡(Brief/分镜/拆解/交付包)。5 类呈现卡无对应卡型 → 要么扩 contracts 定义卡型,要么靠模型 respond 流式 markdown(前端难结构化渲染)。
3. **方向冲突**:A(IK5LR4)是平台真生成语境;B(本地cc)止于提示词。要确认后端走哪条——真生成(A 原意)还是搬 B 的止于提示词。

## 7. 关联工单全清单(全 PM 创建)

| 族 | map | 子票 | 状态 |
|---|---|---|---|
| 呈现规格 | **IK5LR4** | 17票(IK5LRV/LRY/LSB/LTA/LUB/LTC/LUC/LUE/LUN/LV0/LV3/LV6/LV9/LVA/LVB/LVJ/LVK)+ IK663F | closed(spec 已交付) |
| 决策面/声明式 | **IK3HB7** | IK3HBH、IK3HBK | closed |
| 编排源修订 | — | IK5MNJ·IK5MAR·IK5ODM·IK5OXV·IK5QDN·IK7704·IK770F | 全 closed(已落 B) |
| 本地cc验证 | **IK6L13** | T1-T8(IK6L1O/L2H/L2L/L2Z/L33/L34/L35/LQV) | closed(验证通过) |
| 断点修复 | **IK76NL** | F1-F6(IK76OL/OR/OZ/P3/P8/PE) | **已完成(2026-08-10 收口)** |

## 8. 背景:后端为什么没接上(KimJohn 工程工单,非 PM 需求)

- **IK3UWN**(KimJohn,closed):后端 TS 迁移总体方案——product-api 还没建、bundle 装载没移植。
- **IK2D8R**(KimJohn,已回收):runtime bundle 工程迁移——PM 提 IK3HB7(设计输入),工程落地是 KimJohn 的 IK2D8R。

## 9. 测试同学验证口径

- **B(本地 cc)可验**:IK6L13 实跑通过 + IK76NL 断点修复收口,可做回归(止于提示词交付包)。
- **C(后端 TS)验不了 video-director**:后端没装载这套编排,director 行为不在后端。
- **要验后端 video-director**:等 director 行为注入后端(runtime bundle 移植 / 新 spec 落地)后再排。
