# Test Matrix：AI 音频生成入口（mock）

> Scenario ↔ 测试。纯函数/组件单测；page 接线 tsc + dev round-trip；mock 边界单测。

| Spec Scenario | 测试 | 文件 |
|---|---|---|
| 上传音频节点可播放 | 「audio 有 src 渲染 `<audio>` + 控制条」 | v2/nodes.test.tsx |
| 左「音频」按钮开 Dock | 「handleToolClick(audio) → bottomDockMode=audio + open」（page 接线，dev 验） | page（tsc+dev） |
| 音频 Dock 本地上传 → 参考区+节点 | 「handleDockLocalUpload audio 建节点」（已有）+ Dock 参考区（dev 验） | page/dev |
| mock 生成 → 可播放 + recipe | 「generateAudio mock 返固定 url/assetId + 不发真请求」+「buildGenerationRecipe audio 字段」 | generation.test/engine.test |
| mock 生成失败 → 占位+重试 | 「generateAudio reject → 节点 error 占位」（dev/集成） | dev |
| 从画布选参考 | 「pickingFor=audio → 选节点入参考区」（dev） | dev |
| 图/视 Dock 无回归 | 「BottomDock mode=image/video 渲染对应组件」（回归） | BottomDock 渲染测试 |
| generateAudio mock 不调真后端 | 「fetch/apiRequest 未被调 + 返固定 sample」（mock 边界） | generation.test |

## 补充单元测试

- `AudioPlayer`：渲染 `<audio preload=metadata>` + 控制条（播放按钮 + 进度 + 时长）；无 src 占位。
- `generateAudio` mock：固定 delay + 返回 `{url: sample, assetId: 假}`；断言不发 HTTP。
- `buildGenerationRecipe`（audio）：mediaKind=audio + AudioGenParams{duration,sampleRate,format} + inputs。
- `MediaStateBody` audio：error/running 分支（通用）+ done(src→AudioPlayer)/无 src(占位)。
