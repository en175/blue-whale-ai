# 任务清单（v2 strangler 模式，见 ADR-0023）

## 1-4. L0-L4 底座 ✅

- [x] model / kinds / engine / store（`_canvas/{model,kinds,engine,store}.ts`）+ 18 测试绿（vitest）

## 5. v2 展示层（`_canvas/v2/` + `app/canvas-v2/`）✅ 部分

- [x] 5.1 `CanvasSurface.tsx`：RF 受控 store（doc.nodes/viewport）+ measured 缓存 + setNodes
- [x] 5.2 `nodes.tsx`：MediaNode/TextNode/GroupNode（VideoPlayer 播放 + NodeToolbar 操作浮层 + NodeResizer + assetId 查 store.assets + DESIGN 样式复刻）
- [x] 5.3 `app/canvas-v2/page.tsx` MVP：store + listProjects/load + addNode 工具栏 + 拖拽 + 保存
- [ ] 5.4 rf-adapter 单测（nodeTypes 来自 registry / onNodesChange 更新 store / edges 空）

## 6. v2 page 全搬（fresh session，🔴 最大块）—— 6 接点见 memory

- [ ] 6.1 store 加 `addNodeFull(node)`（page 算 position+extra 后传入；现 addNode 只接 kind）
- [ ] 6.2 生成 `onImage` 三路径（streamJob/非流式/视频）→ `store.addAsset + patchNode`，assetId 全 `String()`
- [ ] 6.3 复用老 `_canvas/components/`（TopBar/LeftToolbar/BottomDock/AgentChatPanel/ZoomControls）接 store
- [ ] 6.4 `useCanvasProjects` 瘦身：项目列表/messages/CRUD/switch 保留，canvas（set-canvas/save）退役由 store 接管，switch 触发 `store.load`
- [ ] 6.5 status 枚举：旧 loading/ready/error → 新 idle/running/done/error
- [ ] 6.6 `recover.ts`/`persist.ts` 类型适配（NodeItem→CanvasNodeData）

## 7. 数据清理 🔴

- [ ] 7.1 清表 `UPDATE canvas SET nodes_json = NULL`（15 条旧数据）；assets 表 88 条保留

## 8. 验收

- [ ] 8.1 `openspec validate canvas-frontend-architecture --type change --strict` 过
- [ ] 8.2 vitest canvas 相关全绿
- [ ] 8.3 v2 round-trip（load/addNode/拖拽/保存/生成/恢复）对比老 `/canvas` 功能对齐
- [ ] 8.4 v2 对齐后替换老 `/canvas`（重定向或删老路由 + 老 `_canvas` 文件）
