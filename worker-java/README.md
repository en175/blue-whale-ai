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

## 现状进度（IKEL4L）

- [x] 工程骨架 / 配置绑定 / `/ready` / 消息契约测试
- [ ] MQ 连接装配与 4 消费者（media_extract 先行，IKEL4N）
- [ ] backend internal endpoints 客户端（待 IKEL4J 交付端点契约 §4 定稿）
- [ ] TOS Java SDK 坐标与 ffmpeg 子进程封装（IKEL4N 时引入，勿提前猜版本）
