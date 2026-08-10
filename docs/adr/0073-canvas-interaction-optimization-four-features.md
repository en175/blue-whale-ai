# 画布交互优化四需求

- **状态**：Accepted
- **日期**：2026-08-10
- **决策者**：shuggg（李述）
- **关联工单**：[IK76K1 画布交互优化](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK76K1)
- **关联决策**：[ADR-0027 canvas generation hook hydrate](0027-canvas-generation-hook-hydrate.md)、[IK65OQ 积分体系](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK65OQ)、[IK74TX 首页输入框重构](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK74TX)

## 问题

画布（/canvas）是用户的核心创作工作台，当前存在四类直接伤害创作体验的问题：

1. **共享资产弹窗假文件夹系统**：侧栏文件夹可点可新建，但与卡片无关联，切换内容不变，刷新消失。
2. **画布无撤销/重做**：误删节点、误拖动无补救，已生成素材丢失意味着积分白花。
3. **生成任务并发卡死 1**：一个生成任务在跑时所有面板生成按钮禁用，用户只能干等。
4. **节点删除无保护**：误删节点即时消失，无确认、无提示、无法找回。

## 决策

四个需求彼此独立，唯一的强联动是需求四依赖需求二的撤销能力，建议同批交付。以下分别记录各需求的架构决策。

---

### 决策一：共享资产弹窗移除文件夹侧栏

**方案：** 完整移除弹窗左侧文件夹区域，弹窗变更为单一主区结构。

**技术要点：**
- `CardLibraryPicker.tsx`：删除 `folder`/`folders` 状态、侧栏 JSX（约 200px 宽区域）、`Folder`/`FolderPlus` 图标导入及"新建文件夹"按钮
- 弹窗宽度从 1040px 收窄至约 840px（减去侧栏 200px）
- 保留 tabs 筛选、资产类型下拉、搜索、多选批量导入、详情浮窗、`···` 菜单等全部现有能力
- 商品卡导入复用入口（`cardTypeFilter` 传 `["product"]`）不受影响
- 不承诺真文件夹未来实现，属新需求

**影响范围：** 仅 `CardLibraryPicker.tsx`，无后端改动。

---

### 决策二：画布基础撤销/重做

**方案：** 在 `useCanvasDoc` 层新增撤销/重做历史栈，覆盖节点删除与节点移动两类操作。

**技术要点：**
- **历史栈位置**：`useCanvasDoc` hook 内新增 `undoStack`/`redoStack` ref，每次 `onNodesChange`（position/remove 类型）或 `onEdgesChange`（remove 类型）时记录快照
- **快照粒度**：一次"按下到松开"的完整拖动算一步（不按像素逐帧记录），一次删除操作算一步
- **多选原子性**：框选后批量删除/移动，撤销时整体恢复
- **快捷键**：撤销 `Ctrl+Z` / `Cmd+Z`；重做 `Ctrl+Shift+Z` / `Cmd+Shift+Z`
- **键盘事件**：在 `CanvasSurface` 层监听，非输入框焦点时生效
- **历史上限**：至少 20 步，超限丢弃最旧步骤
- **标准语义**：撤销后执行新操作作废可重做分支
- **不做范围**：节点文本编辑、参数修改、素材替换、连线操作——跳过不报错
- **不跨会话**：刷新页面或切换项目后历史清空

**影响范围：** `useCanvasDoc.ts` + `CanvasSurface.tsx` + `use-node-clipboard.ts`（右键删除入口），无后端改动。

---

### 决策三：生成并发上限 3

**方案：** 在 `useCanvasGeneration` 层接入 `useVideoJobs.activeCount()` 做并发限流。

**技术要点：**
- **限流位置**：`useCanvasGeneration.generate()` 入口，调用 `jobs.activeCount()` 判断当前进行中任务数
- **上限值**：3，与积分体系工单 IK65OQ 保持一致
- **拦截行为**：达到 3 时第 4 次提交被拦截，提示文案包含"已有 3 个任务正在生成"与"请等待已有任务完成后再提交"
- **名额释放**：任务成功/失败/取消后 `activeCount` 自动减少
- **防重复提交**：现有 `generating` boolean 锁继续保留，连点只产生一个任务
- **首页跳转链路**：`use-home-jump-consumer` 同样受限于该 `generate` 入口，自动受保护
- **刷新恢复**：`recover()` 恢复显示服务端仍在跑的任务并占用名额

**常量定义**：`MAX_CONCURRENT_GENERATION = 3` 定义在 `blue_whale_web/app/canvas/_canvas/hooks/useCanvasGeneration.ts` 头部，IK65OQ 调整时同步修改此值。

**影响范围：** `useCanvasGeneration.ts` 头部 + `generate()` 函数，无后端改动（后端 worker 并发 8 独立于前端限流）。

---

### 决策四：节点删除 toast 撤销

**方案：** 删除节点时弹出轻提示，点击"撤销"触发一次撤销操作。

**技术要点：**
- **Toast 扩展**：`Toast` 组件新增 action 按钮支持（`{ label: "撤销", onClick }` 字段）
- **删除入口**：`useCanvasDoc.removeNodeAndSave()` 及 `onNodesChange([{ type: "remove" }])` 触发 toast
- **删除计数**：批量删除时显示"已删除 N 个节点 [撤销]"
- **Toast 行为**：3 秒自动消失；不阻塞画布操作
- **连续删除**：toast 覆盖更新为最新一次，不做堆叠
- **撤销联动**：点 toast 的"撤销"等价于一次 `Ctrl+Z` 撤销操作

**影响范围：** `useCanvasDoc.ts`（删除触发 toast）、`Toast.tsx`（支持 action 按钮）、`CanvasSurface.tsx`（键盘删除入口），无后端改动。

---

## 不决策范围

以下事项明确不属于本 ADR 决策范围：

- Dock 内假积分数字与"积分模式"按钮（等 IK65OQ 整体落地）
- 共享资产弹窗"场景/其他"两个空 Tab（维持现状）
- 节点连线/工作流编排（维持休眠）
- 音频面板真实化（TTS 等，IK7696 已拒绝关闭）
- 撤销/重做覆盖文本编辑、参数修改、素材替换
- 生成任务排队队列
- 撤销历史跨刷新/跨会话持久化
- 真文件夹系统

## 测试策略

四个需求各有独立验收场景，详见工单 IK76K1 描述中的 Testing Decisions 章节。回归底线：首页跳转画布自动生成链路、节点进度轮询与恢复、项目快照恢复、商品卡导入复用不得破坏。