# worker-java

Blue-Whale 生成执行服务（Java 薄执行器）。决策：[ADR-0084](../docs/adr/0084-generation-worker-java-runtime.md)；
行为契约（冻结基准）：[docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md](../docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md)。

技术栈：**Spring Boot 3.3.x + JDK 21（LTS）**（ADR-0084 决策 1）。

## 硬边界（违反即评审拦截项）

- **本进程不实现任何 job 状态机**。claim / fencing / lease / complete / fail 一律走
  backend internal endpoints（契约 §4）。guard fail 静默语义必须保留（契约 §3.1）。
- `cost_reservations` 记账不在实现范围（契约 §0 修正一，退役由 IKEF1K 承接）。
- 环境变量名与 TS worker 完全同名（灰度期一套部署 env 喂两个栈）。

## 灰度开关

`WORKER_ENABLED_TAGS` 逗号列表（`step,image,audio,media_extract`），默认为空 = 不消费。
一刀切换 = TS 侧停该 tag + 此列表加该 tag；consumer group 后缀 `-java`（双组并存即回滚位）。

## 构建 / 运行

```bash
mvn -B test          # 契约测试（GenerationMessageContractTest 是契约 §1 的可执行切片）
mvn -B package
java -jar target/worker-java-0.0.1-SNAPSHOT.jar
curl localhost:4002/ready
```

## 刀①运行手册（media_extract）

### 环境变量清单

| 变量名 | 必需 | 说明 | 默认值 |
|---|---|---|---|
| `WORKER_ENABLED_TAGS` | 灰度控制 | 逗号分隔启用 tag（`media_extract`） | 空 = 不消费 |
| `WORKER_GROUP_SUFFIX` | consumer group | consumer group 后缀 | `-java` |
| `DATABASE_URL` | 是（media_extract 启用时） | `mysql://user:pass@host:port/db` | — |
| `ROCKETMQ_ENDPOINTS` | 是（media_extract 启用时） | gRPC proxy 端点 | — |
| `ROCKETMQ_ACCESS_KEY` | 否 | RocketMQ 认证 | — |
| `ROCKETMQ_SECRET_KEY` | 否 | RocketMQ 认证 | — |
| `ROCKETMQ_SSL_ENABLED` | 否 | 启用 SSL | `false` |
| `ROCKETMQ_TOPIC` | 否 | MQ topic | `generation-video` |
| `VOLC_ACCESS_KEY_ID` | 是（media_extract 启用时） | TOS 认证 | — |
| `VOLC_SECRET_ACCESS_KEY` | 是（media_extract 启用时） | TOS 认证 | — |
| `VOLC_TOS_ENDPOINT` | 是（media_extract 启用时） | TOS 端点 | — |
| `VOLC_TOS_BUCKET` | 是（media_extract 启用时） | TOS 桶 | — |
| `VOLC_TOS_REGION` | 是（media_extract 启用时） | TOS 区域 | — |
| `FFMPEG_PATH` | 否 | ffmpeg 二进制路径（Dockerfile 须 ship 一个） | `ffmpeg`（PATH 查找） |
| `MEDIA_EXTRACT_CONCURRENCY` | 否 | 提取并发度（1-16） | `2` |
| `GENERATION_WORKER_PORT` | 否 | HTTP 端口 | `4002` |

### 启动行为

- `WORKER_ENABLED_TAGS` 为空 → 不连 MQ、不连 DB，只起 `/ready` 端点。
- `WORKER_ENABLED_TAGS` 含 `media_extract` → 必须配齐 `DATABASE_URL` + `ROCKETMQ_ENDPOINTS` + `VOLC_*` 5 个 TOS env，缺一启动失败。
- ffmpeg 运行时依赖：`FFMPEG_PATH` 指向的二进制必须存在（Dockerfile 已 apt install）。

### Docker 部署

```bash
# 构建
mvn -B package -DskipTests
docker build -t worker-java .
docker run -e WORKER_ENABLED_TAGS=media_extract \
           -e DATABASE_URL=mysql://... \
           -e ROCKETMQ_ENDPOINTS=... \
           -e VOLC_ACCESS_KEY_ID=... \
           -e VOLC_SECRET_ACCESS_KEY=... \
           -e VOLC_TOS_ENDPOINT=... \
           -e VOLC_TOS_BUCKET=... \
           -e VOLC_TOS_REGION=... \
           -p 4002:4002 worker-java
```

## 包结构（DDD 分层，包=统一后缀）

```
worker/
├─ application/{consumer(*Consumer), processor(*Processor), service(*Service)}
├─ domain/{entity(*Entity), dto(*Dto), error(*Error)}
├─ infrastructure/{mapper(*Mapper), mq, media(*Extractor), storage(*Storage)}
├─ config(*Config/*Properties/*Condition) + web(*Controller)
```

## 现状进度（IKENZZZ / IKEL4L / IKEL4N）

- [x] 工程骨架 / 配置绑定 / `/ready` / 消息契约测试（IKEL4L）
- [x] **Job 状态机 extract 子集**（IKENZZZ）：
  - [x] `DataSourceConfig`：DATABASE_URL 解析（mysql:// → jdbc:mysql://，含特殊字符）+ HikariCP 保守池（max 10）
  - [x] persistence 包：`GenerationJob` / `Asset` / `GenerationJobLog` / `ProjectEvent` / `Canvas` + 对应 Mapper
    - SQL 逐字移植自 TS Prisma 调用，注释标注 TS 源码行号
    - CAS updates 返回 int，service 层映射 0→false
  - [x] service `JobStateMachineService`（@Service，单例权威）：
    - `claimMediaExtract(jobId, workerId)` → Optional<ClaimedMediaExtractJob>
    - `updateMediaExtractProgress` → boolean：钳制 0-99 + 续租（lease≈now+120s）
    - `publishMediaExtractResult` → boolean（@Transactional）
    - `failMediaExtractJob` → boolean（@Transactional）
  - [x] service `CanvasNodeService`：画布节点 CAS 更新（版本守卫 + 冲突重试 MAX_RETRY=3）
    - `updateMediaExtractNodeToAudio` / `failMediaExtractNode`
- [x] **media_extract 执行路径**（IKEL4N 刀①）：
  - [x] mq `AbstractGenerationConsumer`：TEMPLATE METHOD（start/stop lifecycle, receive loop, poison ack, Semaphore 并发）
  - [x] mq `MediaExtractConsumer`：tag=media_extract, digitGuard=false
  - [x] processor `JobProcessor` STRATEGY 接口 + `MediaExtractJobProcessor` 完整编排
  - [x] media `FfmpegExtractor`：ProcessBuilder 逐字参数、Duration regex、out_time_ms 进度、无超时
  - [x] storage `TosMediaService`：SDK getObject / putObject / putObjectAcl（DEVIATION 注释）
  - [x] config `MediaExtractEnabledCondition`：@Conditional 按 tag 启停
  - [x] config `StubDataSourceConfig`：未启用时的空 DataSource 回退
  - [x] Dockerfile：eclipse-temurin:21-jre + ffmpeg apt install
- [x] tests（52 全绿）：
  - 契约测试 6 + 状态机金标 10 + URL 解析 7 = **23（已有）**
  - consumer template 5 + ffmpeg regex 12 + processor 错误映射 12 = **29（新增）**
- [ ] backend internal endpoints 客户端（待 IKEL4J 交付端点契约 §4 定稿）
- [ ] 其他 3 消费者（step / image / audio）
