# 集成测试运行手册

设置表中对应的数据库环境变量，再从仓库根目录执行指定测试文件。本文承接 IKJRH0 清理前集成测试中的人工跑法和验收说明；环境门控、测试数据和业务断言仍在测试源码中维护。

## 运行步骤

1. 为每个套件准备独立的本地 MySQL 数据库。恢复协议套件会在 `beforeEach` 清理业务表，共库并行会互相删除测试数据。
2. 业务表套件先将仓库当前 Prisma schema 应用到该隔离数据库。时区和来源唯一约束探针自行创建探针表。
3. 设置该套件的环境变量，运行一个测试文件。
4. 确认断言执行结果。缺少环境变量时的整组跳过不算真库验收通过。

业务表套件的 schema 准备命令为：

```bash
DATABASE_URL="$BW_INTEGRATION_DATABASE_URL" pnpm --dir backend exec prisma db push
```

`BW_INTEGRATION_DATABASE_URL` 是当前套件隔离数据库的连接串。以时区探针为例：

```bash
IKHJ0Q_DATABASE_URL="$BW_INTEGRATION_DATABASE_URL" \
  pnpm exec vitest run backend/libs/shared/persistence/tz-caliber.integration.test.ts
```

其他文件使用下表对应变量替换 `IKHJ0Q_DATABASE_URL`，并传入对应文件路径。

## 恢复与持久化套件

| 测试文件 | 数据库环境变量 | 原有本地端口及库名 | 核对行为 |
| --- | --- | --- | --- |
| [ikjjqu-canvas-recovery](../../backend/libs/shared/persistence/ikjjqu-canvas-recovery.integration.test.ts) | `IKJJQU_DATABASE_URL` | `3307 / bw_gate_ikjjqu` | 普通生成提交归属、恢复查询、幂等重放、并发冲突和保存回滚 |
| [ikjjqw-media-tool-recovery](../../backend/libs/shared/persistence/ikjjqw-media-tool-recovery.integration.test.ts) | `IKJJQW_DATABASE_URL` | `3308 / bw_gate_ikjjqw` | 单结果媒体工具受理、虚拟输出、重试与冲突前零写入 |
| [ikjjqy-canvas-recovery](../../backend/libs/shared/persistence/ikjjqy-canvas-recovery.integration.test.ts) | `IKJJQY_DATABASE_URL` | `3309 / bw_gate_ikjjqy` | 多结果逐项恢复与删除、输出归属、原子保存和历史关联 |
| [ikjjqz-mix-mux-canvas-recovery](../../backend/libs/shared/audio-mixes/ikjjqz-mix-mux-canvas-recovery.integration.test.ts) | `IKJJQZ_DATABASE_URL` | `3310 / bw_gate_ikjjqz` | 混合与合成的创建、同 job 重试、新旧提交归属、取消后再生成 |
| [ikjjr0-canvas-recovery](../../backend/libs/shared/persistence/ikjjr0-canvas-recovery.integration.test.ts) | `IKJJR0_DATABASE_URL` | `3311 / bw_gate_ikjjr0` | 成片及重生样片受理、并发幂等、冲突拒绝与预扣失败补偿 |
| [ikjku2-canvas-recovery](../../backend/libs/shared/persistence/ikjku2-canvas-recovery.integration.test.ts) | `IKJKU2_DATABASE_URL` | `3312 / bw_gate_ikjku2` | 新协议保存不得省略受保护卡；旧协议及方案应用绕过同样拒绝 |
| [ikjku8-canvas-recovery](../../backend/libs/shared/persistence/ikjku8-canvas-recovery.integration.test.ts) | `IKJKU8_DATABASE_URL` | `3313 / bw_gate_ikjku8` | 保存回执丢失后的同身份、同摘要重放先于版本检查，不重复推进 |
| [ikjlts-canvas-recovery](../../backend/libs/shared/persistence/ikjlts-canvas-recovery.integration.test.ts) | `IKJLTS_DATABASE_URL` | `3314 / bw_gate_ikjlts` | apply 与 restore 的资产必须属于任务可信产物；拒绝时整笔回滚 |
| [ikjltt-canvas-recovery](../../backend/libs/shared/persistence/ikjltt-canvas-recovery.integration.test.ts) | `IKJLTT_DATABASE_URL` | `3316 / bw_gate_ikjltt` | 旧 primary 不得改动新受理归属，混入旧操作时整笔拒绝 |
| [ikkbl9-canvas-recovery](../../backend/libs/shared/persistence/ikkbl9-canvas-recovery.integration.test.ts) | `IKKBL9_DATABASE_URL` | `3317 / bw_gate_ikkbl9` | 受保护项判据锚定节点持有者：陈旧标记可推进到持有者，缺席仍须声明持有者 |
| [ikjltx-media-tool-replay](../../backend/libs/shared/persistence/ikjltx-media-tool-replay.integration.test.ts) | `IKJLTX_DATABASE_URL` | `3309 / bw_gate_ikjltx` | 原意图回读先于素材等可变状态；旧关联重放不重新取得当前归属 |
| [ikjlxe-canvas-recovery](../../backend/libs/shared/persistence/ikjlxe-canvas-recovery.integration.test.ts) | `IKJLXE_DATABASE_URL` | 以本地隔离库配置为准 | 首次 primary 与目标卡成对转换、同状态重复 apply 和回执重放 |
| [ikizqc-finalize-unique](../../backend/libs/shared/persistence/ikizqc-finalize-unique.integration.test.ts) | `IKIZQC_DATABASE_URL` | 原示例为 `3307 / ikizqc_probe` | 同成片来源并发插入恰一行成功；NULL 来源允许重复；失败占位仍占唯一键 |
| [tz-caliber](../../backend/libs/shared/persistence/tz-caliber.integration.test.ts) | `IKHJ0Q_DATABASE_URL` | 原示例为 `13306 / tz_caliber` | 数据库默认时间与 DATETIME 字面量读写均使用北京时间 |

表中端口和库名保留原手册的隔离分配，不作为测试代码的固定配置。运行时以环境变量提供的连接串为准。

## 服务接口套件

| 测试文件 | 数据库环境变量 | 浏览器环境变量 | 核对行为 |
| --- | --- | --- | --- |
| [audio-mixes.enqueue](../../backend/apps/blue-whale/src/api/audio-mixes/audio-mixes.enqueue.integration.test.ts) | `IKI5ZC_TEST_DATABASE_URL` | 无 | 混合任务持久化与入队边界 |
| [audio-video-muxes.enqueue](../../backend/apps/blue-whale/src/api/audio-video-muxes/audio-video-muxes.enqueue.integration.test.ts) | `IKIHPJ_TEST_DATABASE_URL` | 无 | 合成任务持久化与入队边界 |
| [audio-video-muxes.retry](../../backend/libs/shared/audio-video-muxes/audio-video-muxes.retry.integration.test.ts) | `IKIHPL_TEST_DATABASE_URL` | 无 | 合成任务专属重试 |
| [card-rename](../../backend/apps/blue-whale/src/api/canvases/card-rename.integration.test.ts) | `IKFA8X_DATABASE_URL` | `IKFA8X_BROWSER` | 四类卡片改名、生成与重试保留、引用及下载命名同步、刷新恢复 |
| [generation-retry](../../backend/apps/blue-whale/src/api/canvases/generation-retry.integration.test.ts) | `IKDMQV_DATABASE_URL` | `IKDMQV_BROWSER` | 失败恢复、冻结输入重试、编辑后重新生成 |
| [image-draft](../../backend/apps/blue-whale/src/api/canvases/image-draft.integration.test.ts) | `IKDMQQ_DATABASE_URL` | `IKDMQQ_BROWSER`、`IKDUHM_BROWSER` | 草稿创建与恢复、保存失败反馈、原位生成 |
| [image-media-ref](../../backend/apps/blue-whale/src/api/canvases/image-media-ref.integration.test.ts) | `IKDMQR_DATABASE_URL` | `IKDMQR_BROWSER` | 图片媒体引用、关系线同步、持久化与冻结输入 |
| [text-attachment-audio](../../backend/apps/blue-whale/src/api/canvases/text-attachment-audio.integration.test.ts) | `IKFCXE_DATABASE_URL` | `IKFCXE_BROWSER` | 音频附件去重、预览、目标切换、冻结输入与刷新恢复 |
| [text-node-media-index](../../backend/apps/blue-whale/src/api/canvases/text-node-media-index.integration.test.ts) | `IKFM3Q_DATABASE_URL` | 无 | 文本卡媒体索引合法保存、伪造拒绝与存量失效引用豁免 |
| [text-node-unified](../../backend/apps/blue-whale/src/api/canvases/text-node-unified.integration.test.ts) | `IKFM3L_DATABASE_URL` | 无 | 普通文本、历史文本与 HTML、Agent 绑定的统一落盘形态 |
| [video-frame-interpolations-recovery](../../backend/apps/blue-whale/src/api/video-frame-interpolations/video-frame-interpolations-recovery.integration.test.ts) | `IKHSFE_DATABASE_URL` | 无 | 插帧任务回查、历史与当前关联隔离、越权拒绝、入队失败回查 |

浏览器变量由测试中的 `it.runIf` 读取。启用浏览器用例还需该文件所需的数据库；只启用数据库不代表浏览器用例已经执行。

## 验收说明

恢复保存的同身份重放必须返回原回执，版本与输出状态不再推进。同 commandId 的载荷或 If-Match 不同则拒绝，不能把冲突请求当作重放。

受保护卡的合法编辑、显式 remove 和 restore 分别验证。省略卡、删除恢复标记、非法改绑及旧协议绕过必须在写入前拒绝；拒绝后画布文档、版本、恢复项与回执保持一致。

混合与合成的任务重试可复用 jobId，提交身份仍需推进。旧关联转为 transferred 后，恢复查询不得将已重置任务的新状态归到旧提交。该恢复套件聚焦提交归属；预扣、额度和失败补偿以实际计费链路的验收为准。

时区测试同时核对 `db.ts` 的 `timezone: "+08:00"` 与 Prisma MariaDB adapter 补丁对应的读写结果。只检查某个配置或补丁文本，不能替代两条时间写入路径的数据库断言。

部分服务接口套件使用进程内 billing 客户端桩放行 hold 与 quote，或替换 RocketMQ 入队。具体替身见各文件的 `vi.mock`。这些断言覆盖接口及数据库行为；余额、流水和真实消息投递另按对应验收执行。

## 清理记录

本轮核查全部 45 个 `*.integration.test.ts`，从其中 24 个文件删除 828 条普通注释。删除前后 TypeScript 语法树和去除注释后的编译输出一致，字符串、SQL 模板、环境门控和测试断言保持一致。

人工操作说明已迁入本文。必要工具指令、许可证和 Vitest mock 工厂注释按实际消费者分别识别；这 24 个文件本次扫描未发现此类保留项。测试是否通过及真库、浏览器是否实际运行，以对应提交的验证记录为准。
