# IJZYWD — [ARCH-6] feat: Canvas 状态抽 `useProject()` hooks

> **工单**：[IJZYWD — Canvas 状态抽 useProject() hooks](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYWD)
> **父 issue**：[IJZYUL](./README.md)
> **状态**：🔄 进行中（分支上，待 PR 审核）
> **分支**：`feature/IJZYWD-canvas-useProject`
> **完成日期**：—

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

## `/review` 双轴复查

- **Standards**：（待 review 完成补）
- **Spec**：（待 review 完成补）

## 状态时间线

| 时间             | 事件                                                  |
| ---------------- | ----------------------------------------------------- |
| 2026-07-10 15:45 | IJZYWD worktree 创建 + CBM 索引 + npm install         |
| 2026-07-10 16:05 | useProject.ts + index.ts + page.tsx refactor 完成     |
| 2026-07-10 16:09 | useProject.test.ts 10 tests pass（jsdom 环境 + directive） |
| 2026-07-10 16:11 | 三件套绿（89/89 / build pass / IJZYWD 自己 0 lint）   |
| 2026-07-10 16:13 | impl commit `4cd002c`                                 |
| 2026-07-10 16:14 | /review 双轴并行                                      |

## 备注

- 本次提交含 **IJZYWD 实现 + 本 docs**（按 IJZYUL 约定：「每一个子issue完成的时候,把记录的一起提交到分支里去当做记录」）
- 4 个 impl 文件全部围绕 hook 抽离，无顺手"重构相邻代码"
- 父 issue IJZYUL 总进度 IJZYWD 完成 → 6/8 完成（README 待 IJZYUL 全结束更新）
- 测试用 `// @vitest-environment jsdom` 指令，未改 vitest.config.ts（项目现有 config 不指定 environment，非 React 测试默认 node）

---

完成项（已落到分支）：
1. /review Standards + Spec 反馈应用（AC6 / API 不对称 / 死三元 / isolation 断言）
2. docs commit + impl + 推送 + 建 PR → 等用户发布授权