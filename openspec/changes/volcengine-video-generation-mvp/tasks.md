## 1. Seedance 视频模型种子数据

- [ ] 1.1 `blue_whale_server/src/main/resources/schema.sql` 在现有 4 条 `doubao-seedream-*` 图片 INSERT 后追加 `doubao-seedance-2-0-260128`：`capability_type='video'`、`supported_sizes='[{720p,1080p,480p}]'`、`supported_aspect_ratios='["16:9","9:16","1:1"]'`、`supported_formats='[]'`、`default_size='720p'`、`default_aspect_ratio='16:9'`、`features` 关 `stream`/`sequential_image_generation`/`tools`、`quantity_max:1`、`reference_image:true`
- [ ] 1.2 （可选）追加 `doubao-seedance-1-5-Pro-251215` 作对比模型（同结构，`default_size='720p'`、`ratio='adaptive'`）
- [ ] 1.3 让种子生效：新建库重跑 `schema.sql`；现有 dev 库（docker MySQL）手动执行 1.1 的新 INSERT 行（注意 `uk_provider_model` 唯一键，勿重复 INSERT 图片行）

## 2. 移除 lastFrameUrl 死字段

- [ ] 2.1 `dto/VideoGenerateRequest.java` 删除 `lastFrameUrl` 字段（及 getter/setter/构造，约 `:23`）
- [ ] 2.2 `service/GenerationJobService.buildVideoInput`（约 `:290`）去掉尾帧存储逻辑，`input` JSON 仅保留首帧 `firstFrameUrl`
- [ ] 2.3 确认 `createVideoJob`（`:124`）调用 `createVideoTask` 处无 `lastFrameUrl` 残留传递；`VolcEngineService.createVideoTask`（`:120`）签名本就只收单首帧 `imageUrl`，无需改

## 3. 测试跟进

- [ ] 3.1 `GenerationJobServiceTest`：`createVideoJob` 返 `jobId`、`buildVideoInput` 产物 JSON 不含 `lastFrame` 断言
- [ ] 3.2 `VolcEngineServiceTest`：`createVideoTask`/`getVideoTask` mock `ArkService`，验证首帧 `image_url` `role="first_frame"`、无 `last_frame`
- [ ] 3.3 `GenerationControllerTest`：`POST /api/generation/video` 返 `{job_id, status:"queued"}`
- [ ] 3.4 `./mvnw -q test` 通过

## 4. 端到端验证

- [ ] 4.1 `./mvnw -q clean compile` 通过
- [ ] 4.2 配 `ARK_API_KEY` 真值 + 起 docker MySQL（dev profile root/root）+ `./mvnw spring-boot:run`
- [ ] 4.3 `curl 'GET /api/generation/models?capability=video'` 返回 Seedance 模型列表非空
- [ ] 4.4 文生视频：`curl POST /api/generation/video`（带 `prompt`+`modelId`）返 `jobId` → 轮询 `GET /api/jobs/{id}` 到 `succeeded`
- [ ] 4.5 首帧图生视频：`curl POST /api/generation/video` 带 `firstFrameUrl` 同上验证
- [ ] 4.6 确认 `./data/assets/` 下对应 mp4 落盘，`GET /api/jobs/{id}` 返回的 `asset.url` 指向转存地址

## 5. 收尾

- [ ] 5.1 `graphify update .` 更新知识图谱
- [ ] 5.2 `git fetch origin` + `git rebase origin/master`
- [ ] 5.3 commit（`feat: 视频生成接口跑通，补 Seedance 种子数据`）+ 报告待审查（不 push/不开 PR，待用户授权）
