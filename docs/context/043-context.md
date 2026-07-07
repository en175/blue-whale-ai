# 043-context — 项目下拉菜单：画布工作区按项目隔离 + localStorage 持久化 + 新建/删除

## 时间
2026-07-06

## 背景
画布左上角项目下拉菜单（`ProjectMenu`）此前：
1. TopBar 按钮文字硬编码 `"2026-06-30 09:54"`，与激活项目无关。
2. `PROJECTS` 是静态常量，`active` 焊在数据上；点列表项不切换；**切换项目不带动画布内容**。
3. New / Delete 按钮纯视觉，无业务逻辑。

目标（最终范围）：每个项目是一份**完全独立的画布工作区**（节点 + 双 Dock 参考素材 + 选中 + 视口），切换项目即换工作区；用 localStorage 持久化；接通 New / Delete。

## 改动

### 1. 新增 `app/canvas/_canvas/projectStore.ts`（数据层）
- `Workspace` 类型：`{ nodes, selectedId, viewport, imageDockMedia, videoDockMedia }`。
- 纯函数持久化：`loadProjects / saveProjects`、`loadActiveProjectId / saveActiveProjectId`、`loadWorkspace / saveWorkspace / removeWorkspace`、`emptyWorkspace`、`newProjectId`、`nowTimestampName`。
- localStorage 布局：`bw-canvas-projects`（列表）、`bw-canvas-active`（激活 id）、`bw-canvas-<projectId>`（该项目的 Workspace）。
- 全部读写 `typeof window` 守卫，SSR 安全。
- 经 `_canvas/index.ts` barrel 导出。

### 2. `app/canvas/page.tsx`（`CanvasPageInner`）
- 状态首屏用 SSR 安全默认（`PROJECTS` + 空工作区），**挂载 effect** 再从 localStorage 恢复 `projects / activeProjectId / workspace`，避免水合不一致。
- `applyWorkspace(ws)`：一次性下发 5 类工作区 state。
- `switchProject(id)`：兜底存当前 → 加载目标工作区 → 切激活。
- `handleNewProject()`：新建空工作区项目（名=当前时间戳）→ 切过去。
- `handleDeleteProject(id)`：删项目 + 清其 localStorage；若删的是当前项目则切到剩余首个；一个不剩则自动新建空项目。
- write-through：3 个 `useEffect` 分别在 工作区/项目列表/激活 id 变化时写 localStorage。
- `<TopBar />` 下传 `projects / activeProjectId / onSelectProject / onCreateProject / onDeleteProject`。

### 3. `app/canvas/_canvas/types.ts`
- `Project` 移除 `active?: boolean`——激活态改为运行时派生。

### 4. `app/canvas/_canvas/constants.ts`
- `PROJECTS` 去掉 `active:true`，注释标为种子数据。

### 5. `app/canvas/_canvas/components/TopBar.tsx`
- `TopBar` 接收 5 个 props，下传 `ProjectMenu`。
- `ProjectMenu` 接收 `projects / activeId / onSelect / onCreate / onDelete`：高亮/字重/颜色由 `p.id === activeId` 派生；列表项点击 → `onSelect + onClose`；New Project → `onCreate + onClose`；每项 Trash2 → `onDelete(p.id)`（不关菜单，便于连续删）。

## 验证
- `npm run lint`：本次改动文件（projectStore / index / page / types / constants / TopBar）**零 error**；仓库存量 3 个 error（ChatBubbles / AgentComposer / tailwind.config）均在未碰文件、预存于 master。
- `npm run dev`：`/canvas` 200，Turbopack 编译无错。
- 手动：切换项目→画布内容/Dock/选中随之切换且互相独立；刷新页面后各项目工作区恢复；New/Delete 生效。

## 已知限制 / 不在范围
- **blob URL 不持久**：底部 Dock「本地上传」参考素材走 `URL.createObjectURL`，刷新后失效（浏览器机制）；画布节点图片走 dataURL / http URL，持久正常。
- **整页刷新会重新居中视口**：挂载时视口居中 effect 在恢复 effect 之后执行，覆盖保存的视口；会话内切换项目正常恢复各项目视口。
- **Rename 仍未接**（不在本次范围）。
- 未接后端；项目数据仅 localStorage。

## Git
- 分支：`feature/项目下拉接真实数据`（从 `origin/master` 切出）。
- 提交：`4688f6b feat: 项目下拉菜单接运行时状态，TopBar 跟随激活项目`（S1：纯 UI 切换）；`f502a0f feat: 画布工作区按项目隔离并持久化（切换/新建/删除项目）`（S2：隔离+持久化+增删）。本地未推。
