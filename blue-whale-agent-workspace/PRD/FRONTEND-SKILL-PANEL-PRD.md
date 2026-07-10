# Frontend Skill Panel PRD（P0）

> 给后端/前端工程师的 Skill 面板交付契约。
> 版本:P0 · 日期:2026-07-04
> Skill 接口由 P1 提升至 P0;Skill 被 Agent 实际调用的语义见 `AGENT-CONVERSATION-PRD.md` §5(接入点)。

## 0. 定位

Skill 面板是**独立功能模块**,不是某个页面的附属。它负责让用户管理"哪些 Skill 可被 Agent 使用"以及"以什么方式使用"。

本模块只覆盖 **Skill 面板本身**的展示与交互。Skill 被 Agent 实际调用的语义,在 Agent 对话模块(见 §5 接入点 + `AGENT-CONVERSATION-PRD.md` §5)中定义,两边需联调。

## 1. 范围(P0)

### 包含

- 两个 tab:**我的 Skills** / **Skill 库**
- Skill 库 ⊃ 我的 Skills(引用关系,跟随更新,非副本)
- 库 → 添加到我的;我的 → 移除
- 我的 skill 的 `auto` 开关、`Use` 手动选用
- 封面签名 URL 按需加载(替换现有 33 条硬编码签名)

### 不包含(P0 隐藏,推迟)

- **创建 Skill** tab(写 SKILL.md / 上传 SKILL.md / AI 格式化)整体隐藏
- 对应后端 `POST /skills`、`POST /skills/upload`、`POST /skills/{id}/ai-format` 推迟
- Skill 的编辑、删除库内 skill

> 隐藏不等于删除:前端保留 tab 结构占位,但入口不展示;后端接口可后置实现。

## 2. 关系模型(权威定义)

```
Skill 库(library)
  └─ 全部 skill(后端权威)
       │
       │  用户"添加" = 建立引用关系(user ──skill_id──> skill)
       │  非复制内容
       ▼
我的 Skills(mine)
  └─ 库的一个引用子集
       每条关系上挂: auto: boolean
```

**硬约束**:

1. "我的"是**引用**,不是副本。库里 skill 的封面/名称/描述更新,"我的"中跟随更新。
2. `auto` 是**关系上的属性**,不是 skill 本身的属性。同一个 skill,A 用户开 auto、B 用户关,互不影响。
3. 同一条 `skill_id` 在两个 tab 的"已添加"状态必须**同源、实时一致**。

## 3. 数据契约(给后端)

### 3.1 `GET /api/skills/library`

返回全部 skill,每条带**当前用户视角**的 `added` 标记:

```json
{
  "items": [
    {
      "id": "skl_xxx",
      "name": "电商产品图",
      "description": "...",
      "cover_token": "skl_xxx",      // 用于换签名 URL,不是签名本身
      "source": "official" | "community",
      "added": true                   // 当前用户是否已添加到"我的"
    }
  ]
}
```

### 3.2 `GET /api/skills/mine`

返回当前用户已添加的(即 library 中 `added=true` 的子集),每条带 `auto`:

```json
{
  "items": [
    { "skill_id": "skl_xxx", "auto": true }
  ]
}
```

> 内容字段(name/description/cover)从 library 实时取,`mine` 只存关系 + auto。后端也可在 mine 响应里聚合返回内容字段,但 `skill_id` 必须保留。

### 3.3 关系操作

- `POST /api/skills/library/{id}/add` —— 建立引用(加入"我的"),默认 `auto=false`
- `DELETE /api/skills/mine/{id}` —— 解除引用(从"我的"移除),**不删 skill 本身**
- `PATCH /api/skills/mine/{id}` —— `{ "auto": boolean }`,改关系上的 auto 开关

### 3.4 封面签名

- `GET /api/skills/{id}/signed-cover` —— 按需签发,带过期。前端**不得**缓存签名 URL 超过其 `expires_in`。

## 4. 交互规则

### 4.1 双向同步状态(P0 核心,最易出 bug)

同一条 skill 在两个 tab 的状态必须任何时刻一致:

| 操作 | "我的"列表 | "Skill 库"列表 |
|---|---|---|
| 库里点"添加" | 立刻出现这条 | 该条同步变为"已添加"态 |
| "我的"点"移除" | 该条消失 | 该条同步变回"添加"按钮态 |
| 进面板初始化 | 只显示已添加的 | 全部显示,已添加的标"已添加" |

实现来源:`library` 响应的 `added` 字段 + `mine` 响应互相对齐,前端不改本地状态超过接口返回。

### 4.2 我的 Skills tab

- 列表展示已添加 skill,内容字段实时取自库
- 每条带:
  - **`auto` 开关**:开启 = Agent 自主选用;关闭 = 仅手动 `Use` 时生效
  - **`Use` 按钮**:手动指定使用
  - **移除**:解除引用(不删库内 skill)

### 4.3 Skill 库 tab

- 列表展示全部 skill
- 已添加的:显示"已添加"态(仍可点进"我的"看到)
- 未添加的:显示"添加"按钮
- 支持搜索、排序(沿用现有 search 行为)

### 4.4 封面加载策略

- 列表先用占位图渲染,**不阻塞**面板打开
- 异步请求 `signed-cover`,拿到后填入
- 签名过期或加载失败 → 统一兜底占位图,**不显示裂图**

### 4.5 `Use` 与 `auto` 的语义

| 方式 | 触发者 | 生效范围 | 优先级 |
|---|---|---|---|
| `Use` | 用户手动 | 当前这一条 Agent turn | 高(明确指定优先) |
| `auto=on` | Agent 自主 | 后续所有 turn 候选池 | 低(按 `skill/rules/skill_generation_priority.md` 路由) |

- `Use` 不改变 `auto` 状态(一次性指令,不持久化成 auto)
- `auto=on` 的 skill 进入 Agent 候选池,由 Agent 判断时机,**用户不干预**

## 5. 与 Agent 模块的接入点(边界,需联调)

本模块只负责把"用户选了哪个 skill / 哪些 skill 开了 auto"传出去,**不负责 Agent 如何使用**。Agent 侧承接方式见 **`AGENT-CONVERSATION-PRD.md` §5(接入点)**,要点:

1. 用户点 `Use` → 当前 turn 的请求体携带 `forced_skill_id`,Agent 必须基于它执行(仅决定 skill 选择那一步,不锁后续 Stage)。
2. `auto=true` 的 skill 集合 → Agent runtime 后端自读 `/api/skills/mine?auto=true`(不在请求里传),作为 CEO 路由的候选输入。
3. 若用户 `Use` 与 `auto` 候选冲突 → 以 `Use` 为准(优先级:Use > auto > 未指定)。

> ✅ Agent 模块 PRD 已就位并呼应此接入点,见 `AGENT-CONVERSATION-PRD.md` §5.1。`forced_skill_id` 字段权威定义在 `skill/references/backend_implementation_contract.md` Agent Turn 字段。

## 6. 领域常量收敛

现有前端 `components/SkillPanel.tsx` 的硬编码:

- `MY_SKILLS`(33 条,含 CloudFront 签名 URL)—— **全部移除**,改走 `GET /skills/mine` + `signed-cover`
- `LIBRARY_SKILLS`(6 条,placehold.co 占位)—— **全部移除**,改走 `GET /skills/library`
- `SKILL_MD_TEMPLATE`(创建 tab 用)—— P0 隐藏,保留代码不删

> 现有 mock 数据数量倒挂(我的 33 条 > 库 6 条),接后端后由后端保证"库 ⊇ 我的"。

## 7. 禁止体验

- 不得硬编码签名 URL(已淘汰,会集体过期 403)
- 不得复制 skill 内容到"我的"(引用,非副本)
- 封面签名失败时不得显示裂图,必须兜底占位
- 移除"我的"中的 skill 不得删除库里的原 skill
- `auto` 状态不得跨用户污染(关系属性,非 skill 属性)
- 两个 tab 的"已添加"状态不得出现不同步
- 创建 Skill 入口在 P0 不得对用户可见

## 8. 验收标准(P0)

1. 我的 Skills / Skill 库两个 tab 正常切换,数据全部来自后端(`SkillPanel.tsx` 内零硬编码 skill 数据)。
2. **双向同步**:库点"添加" → "我的"立刻出现 + 库中该条同步变"已添加";"我的"点移除 → "我的"消失 + 库中该条同步变回"添加"按钮。任意时刻两边状态一致。
3. `auto` 开关切换持久化,刷新页面后状态保留。
4. 封面通过 `signed-cover` 异步加载,列表不阻塞;签名失败显示兜底占位,无裂图。
5. 库内 skill 更新(封面/名称/描述),"我的"中同 skill_id 跟随变化。
6. 创建 Skill 入口对用户不可见。
7. **联调验收(依赖 Agent 模块)**:点 `Use` 后,当前 Agent turn 确实按该 skill 执行;`auto=on` 的 skill 会出现在 Agent 后续 turn 的候选中。

## 9. 风险

- **签名 URL 过期**:现有 33 条硬编码签名约 2026-08 过期,P0 必须在此之前切到 `signed-cover` 按需签发,否则"我的"页面集体裂图。
- **双向同步竞态**:用户快速在两 tab 间切换 + 同时操作添加/移除,可能出现本地状态与后端不一致。前端需以接口返回为权威,本地乐观更新失败时回滚。
- **Agent 接入**:`Use` / `auto` 由 `AGENT-CONVERSATION-PRD.md` §5 承接,联调验收见本文 §8 第 7 条。
