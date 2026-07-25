# Test Matrix：画布生成 hook 抽象 + 统一水合

| Spec Scenario | 测试 | 文件 | 阶段 |
|---|---|---|---|
| generate image/video/audio 矩阵 | generate 3 路径（mock api/generation） | useCanvasGeneration.test | P1 ✅ |
| generateFromNode 取上游 prompt | 无 prompt 报错 + image happy（resolveInputs） | useCanvasGeneration.test | P1 ✅ |
| 刷新不建重复（existingNodeIds 去重） | recover existingNodeIds.has(ph.id) 跳过 | useCanvasGeneration.test | P1 ✅（recover 搬迁）|
| 刷新恢复 loading + 续轮询（byTaskId） | hydrate existing→status=running+startVideoJob | useCanvasGeneration.test | P2 |
| reconcile 防永卡 | hydrate succeeded 无 assetId→写 done | useCanvasGeneration.test | P2 |
| recipe references 带 nodeId | 生成带 nodeId 的 DockMediaItem→recipe references nodeId | model.test / mappers.test | P3 |
| 上传参考无 nodeId 兜底 | 上传 DockMediaItem（assetId 无 nodeId）→recipe references assetId/url | mappers.test | P3 |
| page 不接触 job | page 无 useVideoJobs/setNodeAsset/startVideoJob/recover | grep 验证 | P1 ✅ |

## 补充

- generate 3 路径各自纯编排测（mock api/generation，断言建占位 + API 入参 + 写 assetId/done/recipe）。
- generateFromNode 用注入 nodes/edges 构造上游 text prompt（resolveInputs 物化 data.prompt）。
- P2 hydrate 三步（ensureAsset/recover/reconcile）各自测（mock listJobs/getJobStatus）。
- P3 recipe references nodeId/assetId round-trip（serialize→parse 保留）。
- DockMediaItem nodeId 来源（handlePickNode）/ assetId 来源（handleDockLocalUpload 已实现）。
