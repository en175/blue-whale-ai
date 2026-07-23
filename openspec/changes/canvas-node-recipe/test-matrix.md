# Test Matrix：节点 Recipe

> Scenario ↔ 测试名映射。纯函数（model/engine/mappers）单测；page 接线 tsc + dev round-trip。

| Spec Scenario | 测试 | 文件 |
|---|---|---|
| 上传音频 → recipe=uploaded | 「uploaded recipe 无 generation」 | model.test.ts / mappers |
| 图片生成 → recipe 冻结 model+参数+prompt | 「buildGenerationRecipe image 冻结 model/params/inputs」 | engine.test.ts / mappers.test.ts |
| 视频首帧溯源（节点 vs 上传素材） | 「toRecipeInputs firstFrame nodeId 优先，assetId 兜底」 | engine.test.ts |
| recipe 持久化 round-trip | 「generated recipe serialize→parse 深相等」 | model.test.ts |
| 老 /canvas 读带 recipe 不崩 | 「带 recipe JSON parse 不抛 + 已知字段在」 | model.test.ts |
| 老数据无 recipe 正常加载 | 「无 recipe 节点 parse → recipe undefined 不崩」 | model.test.ts |
| 重新生成同参数（P2） | 「recipe.params 预填 BottomDock 纯函数」 | mappers.test.ts |
| 上传节点不可重新生成（P2） | 「origin=uploaded → 无重生成依据守卫」 | nodes/page |
| 节点删除后重生成兜底 | 「prompt nodeId 被删 → 回退 text」 | engine.test.ts |

## 补充单元测试

- `toRecipeInputs`：prompt/firstFrame/lastFrame/references 四类输入 × nodeId/assetId/url/text 来源矩阵。
- `buildGenerationRecipe`：image vs video params 形状区分；jobId/generatedAt 写入。
- serialize：uploaded（无 generation）/ generated（全字段）/ derived（transform+source）三态 round-trip。
