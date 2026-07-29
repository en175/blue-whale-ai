# 案例卡片 → canvas：IK4QUV 输入端衔接 IK4Q48

> 配套：[IK4QUV 前置缺口 + 技术方案](./2026-07-28-IK4QUV-prereq-gaps-and-tech-plan.md)（卡片 → 点生成前半段）

## TL;DR

IK4QUV = 首页案例卡片**输入端**。用户点卡片拿模板 + 换图 + 点生成 → 进 canvas → 走 IK4Q48 场景卡创作流（agent 对齐 → 计划卡 → 手动应用 → 场景卡 → 生成）。IK4QUV 不定义 canvas 内流程。

---

## 一、IK4QUV ↔ IK4Q48 边界

|  | IK4QUV（本 spec） | IK4Q48（@kimjohn，已评审冻结） |
|---|---|---|
| 范围 | 首页案例卡片 → 进 canvas | canvas 内创作流 |
| 「卡」 | **案例卡片**（首页，运营配的结构化模板） | **场景卡**（canvas，agent 产出的 Markdown 节点） |
| 流程 | 点卡片 → 模板回填 → 换图 → 点生成 → 进 canvas | agent 对齐 → 计划卡 → 手动应用 → 场景卡 → 生成 |
| 数据 | 结构化字段（field/value）+ 图片占位符 | 场景卡 Markdown（含 `img_N` 引用） |
| forced skill | 不用 | 不用（自由对齐） |

**接力关系**：IK4QUV 的「模板 + 图」作为初始需求 → 进 canvas → IK4Q48 接手。**案例卡片 ≠ 场景卡**——前者首页输入端模板，后者 canvas 内 agent 产出的节点。

---

## 二、端到端流程

```
[IK4QUV 输入端]
 1. 看案例卡片（标题 + 结构化提示词 + 成片）
 2. 点卡片 → 输入框出现结构化提示词
 3. 点 @[主产品图] 占位符 → 上传图 → 变缩略图
 4. (可选) 改字段值
 5. 点生成 → 「模板 + 图」作为初始需求
                │
                │ 衔接点（#IK4Z8O）：模板+图 → canvas 对话初始输入
                ▼
[IK4Q48 canvas 内]
 6. agent 基于「模板 + 图」对齐需求
 7. 对话内产出「计划卡」(PlanMessage)
 8. 用户点「手动应用」→ 落画布成「场景卡」(SceneCard)
 9. 点场景卡「生成」→ 出素材
```

---

## 三、关键业务决策

- **IK4QUV 输入端定位**：只管首页 → 进 canvas，不定义 canvas 内流程。
- **canvas 内走 IK4Q48**：对齐 → 计划卡 → 场景卡 → 生成，全归 IK4Q48 spec。
- **不用 forced skill**：IK4QUV 进 canvas 后走 IK4Q48 自由对齐流；用户掌控通过 IK4Q48「手动应用计划卡」节律实现，不需要 forced skill 锁定。
- **产出形态交 IK4Q48**：IK4QUV 不规定产出（场景卡 / 视频 / 图），那是 IK4Q48 范围。

---

## 四、现状对照

| 步 | 现状 | 判定 |
|---|---|---|
| 1-2 卡片 + 回填 | IK4QUV 未落地（卡片无结构化字段）；IK170R 前端回填链路在，回填的是 title | 🔴 IK4QUV 缺口 |
| 3-4 占位符 + 改值 | contentEditable + `insertSkillIntoEditor` 可复用 | 🟡 要新建 |
| 5 点生成 | `handleGenerate` 跳 `/generate?prompt=`（只传文本，图丢了） | 🔴 要改：跳 canvas + 传模板 + 图 |
| 衔接点（模板+图 → canvas 对话） | 首页 → canvas 跳转 + 参数没有 | 🟡 #IK4Z8O 要建 |
| 6-9 IK4Q48 流 | 归 IK4Q48（spec 已冻结，实现待其后端重构） | ⚠️ 依赖 IK4Q48 实现 |

---

## 五、child 工单（6 个，挂 IK4QUV，全 ready-for-agent 待认领）

| ident | 段 | 标题 | 归属 | 依赖 |
|---|---|---|---|---|
| #IK4Z8D | 卡片 | 结构化字段数据模型 | 后端 | — |
| #IK4Z8F | 卡片 | 卡片/字段定义/字段值 CRUD API | 后端 | #IK4Z8D |
| #IK4Z8G | 卡片 | 输入框占位符交互（contentEditable 原子 span） | 前端 | — |
| #IK4Z8L | 卡片 | 点卡片结构化回填（替代 card.title） | 前端 | #IK4Z8D, #IK4Z8G |
| #IK4Z8N | 卡片 | 运营后台 UI（卡片 + 字段配置器） | 前端 | #IK4Z8F |
| **#IK4Z8O** | 衔接 | 首页 → canvas 跳转（传模板 + 图作为初始对话需求） | 前端 | #IK4Z8D, IK4Q48 |

**Frontier（无 blocking，可立即开工）**：#IK4Z8D、#IK4Z8G。

---

## 六、缺口 / 依赖

- **D1 IK4Q48 实现**：canvas 内流程依赖 IK4Q48 spec 落地（其后端重构未完）。#IK4Z8O 衔接点要等 IK4Q48 入口就绪。
- **D2 IK2D7Z**：IK4Q48 的 agent 对齐跑在 IK2D7Z Bundle 上（@kimjohn progressing）。间接依赖。
- **D3 IK4QUV 卡片数据**：#IK4Z8D / #IK4Z8F 落地才有结构化模板。
- **P1 衔接方式**（#IK4Z8O 待定）：「模板 + 图」怎么作为初始需求进 IK4Q48 对话（首条消息？预填？参数？）。IK4QUV ↔ IK4Q48 接缝，#IK4Z8O 工单定，需跟 @kimjohn 协调 IK4Q48 入口契约。

---

## 七、跟现有工单关系

```
IK4QUV（首页案例卡片 → 进 canvas，输入端）
  ├─ 卡片：#IK4Z8D / #IK4Z8F / #IK4Z8G / #IK4Z8L / #IK4Z8N
  └─ 衔接：#IK4Z8O（模板+图 → canvas 对话）
        │
        ▼ 衔接后交棒
IK4Q48（canvas 场景卡创作流，@kimjohn，已评审冻结）
  └─ 对齐 → 计划卡 → 场景卡 → 生成
        │
        ▼ 底座
IK2D7Z（声明式 Runtime Agent Bundle，@kimjohn，progressing）
```

- **IK4QUV**：首页案例卡片输入端。
- **IK4Q48**：canvas 内创作流权威。IK4QUV 进 canvas 后全程走它。
- **IK2D7Z**：IK4Q48 底下的 agent runtime 底座。间接依赖。
- IK4QUV 不经 IJZ7Z7（wontfix，被 IK2D7Z 取代）/ IJZ7Z9（rejected，Dock 直生）/ forced skill。
