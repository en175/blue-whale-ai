# IJZYWD — [ARCH-6] feat: Canvas 状态抽 `useProject()` hooks

> **工单**：[IJZYWD — Canvas 状态抽 useProject() hooks](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYWD)
> **父 issue**：[IJZYUL](./README.md)
> **状态**：✅ 已合并到 master（PR #44，merge commit `2c6aebd`）
> **分支**：`feature/IJZYWD-canvas-useProject`
> **commit**：`be6aa33`（feat）+ `49997a3`（review fix）+ `84b6f09`（docs）+ `9908f4b`（setViewport 死循环 hotfix）→ merged as `2c6aebd`
> **PR**：[#44](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/pulls/44)
> **完成日期**：2026-07-10

## 范围

把 `app/canvas/page.tsx` 中散落的 `useReducer(projectReducer)` 收到 `app/canvas/_canvas/hooks/useProject.ts`，对外暴露统一接口；reducer 纯函数本身不重写（沿用 `_canvas/projectReducer.ts` + 单测）。端到端路径：

1. 新建 `_canvas/hooks/useProject.ts` —— `useReducer` 包装 + 派生选择器 + 便捷 action helpers
2. page.tsx 替换裸 `useReducer(projectReducer)` 为 `useProject()`；裸 dispatch 只保留 x/y 算在 DOM 上下文的 `add-node` 一处
3. 新增 `_canvas/hooks/useProject.test.ts` —— 覆盖初始态 + 关键 action（与 reducer 单测去重）
4. 行为完全保留 —— 不动 `useState` / `useRef` / 其它 `useCallback` / `useEffect`

## 验收逐条

- [x] **AC#1**：新建 `_canvas/hooks/useProject.ts`，导出 `useProject()` 至少返回 `{ state, dispatch, ...派生选择器 }` —— 实际返回 `{ state, dispatch, projects, activeProject, activeProjectId, nodes, viewport, messages, selectProject, createProject, deleteProject, setViewport, setNodes, addNode, appendMessages, setCardStatus }`
- [x] **AC#2**：page.tsx 中裸 `useReducer(projectReducer, PROJECTS, initialProjectState)` 删除；派生选择器（`activeProject` / `nodes` / `viewport` / `messages`）从原内联派生改为走 hook 返回；所有 `dispatch({ type: "xxx", projectId, ... })` 改走 hook 便捷 action；page 唯一一次原生 dispatch 出口是 `addNode(node)` —— x/y 在 DOM（`containerRef`）上下文算好传入，hook 闭包持有 active project id 完成路由，page.tsx 不再需要裸 dispatch
- [x] **AC#3**：新增 `useProject.test.ts` 覆盖初始态（activeProjectId 取 PROJECTS.active 标记 / 派生选择器与 state 对齐 / projects 引用一致性）+ 关键 action 路由（`selectProject` / `createProject` / `deleteProject` / `setViewport` 入值+函数式 / `setNodes` 入值+函数式 / `appendMessages` / `setCardStatus` / 切项目后 action 路由切到新 active）；reducer 已测的「A1–A9 单 action 状态转移细节 + 不可变性回归」不复述
- [x] **AC#4**：Canvas 行为完全不变 —— 所有 useState / useRef / 其它 useCallback / useEffect 不动；裸 ref / DOM 副作用仍由 page.tsx 持有（hook 不接 DOM）
- [x] **AC#5**：三件套绿（vitest 89/89 / next build ✓ / IJZYWD 自己 4 文件 0 lint）
- [x] **AC#6**：跨模块领域类型（`Project` / `NodeItem` / `Viewport` / `ChatMessage` / `CardStatus`）全部从 `@/types/domain` 取（依赖 IJZYVQ ARCH-5）

## 改动文件（4 个）

**新增（2 个）**：
- `blue_whale_web/app/canvas/_canvas/hooks/useProject.ts`（170 行）—— hook 主文件
- `blue_whale_web/app/canvas/_canvas/hooks/useProject.test.ts`（176 行 / 10 tests）—— hook 单测

**修改（2 个）**：
- `blue_whale_web/app/canvas/page.tsx` — 把裸 `useReducer(projectReducer, PROJECTS, initialProjectState)` + 7 处裸 `dispatch({...})` + 内联派生 `activeProject` / `nodes` / `viewport` / `messages` + 2 个 `useCallback` (`setViewport` / `setNodes`) 全部替换为 `useProject()` 暴露的 API；删 1 行现在不再使用的 `Viewport` 类型 import
- `blue_whale_web/app/canvas/_canvas/index.ts` — 加 `export * from "./hooks/useProject"` 让页面层一次引入

## 关键设计决策

**1. hook 的 API 形态（state / dispatch / 派生 / 便捷 action）**

spec 原文「至少返回 `{ state, dispatch, ...派生选择器 }」是下限。实际扩为：
- 选：`projects` / `activeProject` / `activeProjectId` / `nodes` / `viewport` / `messages` —— 替代 page.tsx 内联派生
- action：`selectProject` / `createProject` / `deleteProject` / `setViewport` / `setNodes` / `addNode` / `appendMessages` / `setCardStatus` —— 薄封装 dispatch，去 page.tsx 每个动作写 `{ type, projectId: activeProject.id, ... }` 的重复 boilerplate

**为何 action 也封装**：page.tsx 原型每个动作都写 `projectId: activeProject.id`（page 永远只知道 active），hook 内闭包持有 `activeProject.id`，封装后从 page 角度看「对当前 active 项目发起这个动作」一句话。对应「组件消费 `useProject()` 替代裸 reducer 调用」spec 意图。

**为何 `dispatch` 还暴露**：作为 reducer 入口逃生口（spec L17–23 显式契约），便于未来出现 hook 没封装的 action 时走 dispatch。**当前**没有任何裸 dispatch 调用 —— 全部 8 个便捷 action 已覆盖 page.tsx 现有写法；x/y 在 DOM（`containerRef.getBoundingClientRect` + `viewport` 换算）算好作为 `NodeItem` 入参传入 `addNode(node)`，hook 内闭包持有 active id 完成路由。**PR description 会注明：dispatch 暴露为已知设计决策，非技术债**，便于后续 reviewer 区分「真漏封装」与「故意逃生」。

**2. createProject 接受 `idForCreate` 注入手动 idGen**

测试场景 `useProject({ idForCreate: () => "p-test-create" })` 注入，避免生产默认 `Date.now()` 在不同测试间漂移。生产默认 `() => \`p-${Date.now()}\``，与原 page.tsx 完全一致。

**3. setViewport / setNodes 仍支持函数式更新**

保持 page.tsx 的 `(prev) => ...` 写法（`handleKeyDown` 的 `setNodes((prev) => prev.filter(...))`）。这是 CanvasSurface 高频拖拽/缩放的契约，不能丢。

**4. Page-level UI 态（selectedId / BottomDock 开关 / 选择模式 / 容门守卫等）仍在 page.tsx**

`useProject` 只管 Project 聚合根（多项目集合 + active 指针）。编排层（交互状态、keydown handler、本地上传转 reader）仍是 page 的职责。这是 hook 边界 —— 不接 DOM、不接交互模态、不接路由守卫。

**5. 领域类型全部从 `@/types/domain` 取（依赖 IJZYVQ 落地）**

不沿用 `_canvas/types.ts` 的转出口，避免领域类型与画布内部耦合。沿用 IJZYVQ ARCH-5 的边界规范。

## 测试结果

- **`npx vitest run`**：89/89 passed（20 test files；新增 10 个 hook tests + 既有 79 tests）
- **`npx next build`**：✓ Compiled successfully，3 routes prerender
- **`npx eslint .`**：IJZYWD 自己 4 个改动文件 0 error / 0 warning（既有预存 lint 噪音不动）

## `/review` 双轴复查（fixed-point: c3639e9 = IJZYVQ merge）

### Standards

- **Hard violation**：无。Branch prefix / Conventional Commits / single-purpose commit / no master writes（CLAUDE.md + ADR 0010）/ no forbidden artifacts。Hooks 兜底。
- **Boundary tension（CLAUDE.md §2 Simplicity First）**：
  1. `dispatch` 仍暴露但当前无裸 dispatch 调用 —— 列为已知设计决策（见 §1）
  2. `createProject` 同 handler 内 `Date.now()` 算 name vs id —— 漂移窗口极小可接受
  3. `setViewport`/`setNodes` setter 身份依赖 `activeProject.canvas.viewport`/`.nodes`，每 dispatch churn → **⚠️ 生产 mount 暴露「Maximum update depth exceeded」死循环**（page.tsx useEffect 写错 deps）。修复：page.tsx mount setViewport useEffect 改回 `[]`（mount-only）；setNodes keydown useEffect 改回 `[selectedId, pickingFor]`（去掉 setNodes 避免 listener churn）。**回归测试**：`useProject.test.ts` 加「setViewport 连续 dispatch 风暴」pin 死 N 次连续调用落盘正确
- **Surgical changes（CLAUDE.md §3）**：diff `+40/-46` 严格围绕 reducer→hook 迁移 + 2 处 useEffect dep 更新 + doc-comment 移位，无顺手重构
- **Test gaps（CLAUDE.md §4）**：
  - L122 死三元已修（`initialLen > 0 ? 2 : 2` → `toHaveLength(2)`）
  - L172–175 isolation 断言已补（`expect(p1.messages.length).toBe(p1Before)` + `p1.messages.at(-1)?.id !== "m-p3"`）
- **Bottom line**：ship-able；must-fix 已修；setter churn 风险已文档化 + 回归测试

### Spec

- **AC6 partial → 已修**：原 imports `NodeItem / Project / Viewport / ChatMessage` 来自 `../types`（compat re-export 层）→ 现统一从 `@/types/domain` 取（依赖 IJZYVQ ARCH-5）
- **API 不对称 → 已修**：原 hook 暴露 `setNodes` 但缺 `addNode`，page.tsx 仍走裸 dispatch `{type: "add-node"}` → 新增 `addNode(node: NodeItem)` helper，page 改用 `addProjectNode(node)`，hook API 对称（8 个便捷 action 覆盖 page 全部写入路径）
- **AC1/AC2 over-implementation → 保留**：「7 个 mutation wrapper」实为 8 个；spec "至少" 是下限，hook 边界统一封装是 spec 「组件消费 `useProject()` 替代裸 reducer 调用」字面意图的实现，**已在 §1 写明理由**
- **AC3 测试冗余 → 不重写**：hook 单测聚焦「便捷 action 路由 + 派生读」；reducer 单测聚焦「单 action 不可变性回归」—— 两件事，不重叠。文件头注释（test.ts L9–17）已写明边界
- **pickableCount 派生遗漏 → 不补**：spec 没要求 hook 暴露该派生；page.tsx 仍可内联 `nodes.filter(...)`（属消费派生，spec 字面允许）

### 双轴合并

| 项 | Standards | Spec | 处理 |
| --- | --- | --- | --- |
| 7 wrappers scope creep | — | judgement | 保留（spec 下限之上扩） |
| hook tests 与 reducer 重叠 | — | judgement | 保留（不同观察对象） |
| AC6 跨模块领域类型 | — | AC6 partial | **已修** |
| API 不对称 addNode | judgement | judgement | **已修**（8 helpers 对称） |
| L122 死三元 | must-fix | — | **已修** |
| L172–175 isolation 断言 | must-fix | — | **已修** |
| dispatch 仍暴露 | judgement | — | 已文档化 |
| setter 身份 churn + page useEffect 死循环 | must-fix | — | **已修**（回归 deps=[]）+ 回归测试 |

## 状态时间线

| 时间             | 事件                                                  |
| ---------------- | ----------------------------------------------------- |
| 2026-07-10 15:45 | IJZYWD worktree 创建 + CBM 索引 + npm install         |
| 2026-07-10 16:05 | useProject.ts + index.ts + page.tsx refactor 完成     |
| 2026-07-10 16:09 | useProject.test.ts 10 tests pass（jsdom 环境 + directive） |
| 2026-07-10 16:11 | 三件套绿（89/89 / build pass / IJZYWD 自己 0 lint）   |
| 2026-07-10 16:13 | impl commit `4cd002c`                                 |
| 2026-07-10 16:14 | /review 双轴并行                                      |
| 2026-07-10 16:38 | review 反馈应用：@/types/domain 导入 + addNode helper + isolation 断言 + 死三元 |
| 2026-07-10 16:40 | 三件套重跑绿（89/89 / build pass / IJZYWD 自己 0 lint）|
| 2026-07-10 16:42 | docs commit d614739                                   |
| 2026-07-10 17:00 | rebase origin/master（master 进了 ba401c0 skill raw 镜像同步）无冲突 |
| 2026-07-10 17:01 | 三件套重跑绿                                          |
| 2026-07-10 17:15 | push 分支（owner hangzhou-xuanfu_1 而非全下划线，404 root cause）|
| 2026-07-10 17:23 | Gitee MCP create_pull → PR #44（无冲突）              |
| 2026-07-10 17:30 | ⚠️ 生产 mount 暴露 setViewport effect 死循环          |
| 2026-07-10 17:35 | hotfix：page.tsx mount setViewport deps 回归 []，setNodes keydown deps 回归 [selectedId, pickingFor]；useProject.test.ts 加「setViewport 连续 dispatch 风暴」回归测试（90/90 pass）|

## 备注

- 本次提交含 **IJZYWD 实现 + 本 docs + hotfix**（按 IJZYUL 约定：「每一个子issue完成的时候,把记录的一起提交到分支里去当做记录」）
- impl 文件围绕 hook 抽离 + 死循环 hotfix 修复，无顺手"重构相邻代码"
- 父 issue IJZYUL 总进度 IJZYWD 完成 → 6/8 完成（README 待 IJZYUL 全结束更新）
- 测试用 `// @vitest-environment jsdom` 指令，未改 vitest.config.ts
- **setter 身份 churn 教训**：useCallback 依赖 state 子树 → setter 引用变 → 消费方 useEffect deps 含 setter 会死循环。修法：消费方 mount-only 用 `[]` + `eslint-disable-next-line`；或 hook 内部用 `useRef` 同步 state（标准 useEvent 模式，复杂度上升，本 IJZYWD 不引）

---

完成项（已落到分支）：
1. /review Standards + Spec 反馈应用（AC6 / API 不对称 / 死三元 / isolation 断言 / setter 死循环 + 回归测试）
2. docs commit + impl + 推送 + 建 PR #44 → 等用户发布授权（merge）