# 设计：Canvas 生成全链路验收

## 1. 事实边界

MySQL 中的快照、生成任务和素材接口是产品事实源。Redis/BullMQ 只负责唤醒和执行传输。供应商任务 ID 和结果 URL 是执行证据，不是 Canvas 节点身份。浏览器刷新后必须从快照恢复；不能把成功轮询回调当成挂接素材的唯一路径。

实际 BullMQ 入口是 `blue_whale_web/workers/generation-worker.ts`。`apps/generation-worker` 是另一套持久循环入口，不是 Canvas 视频路由使用的 Worker。本变更验证实际 BullMQ 入口，并把另一入口记录为待统一的运行时边界。

## 2. 契约结构

业务任务输入必须显式保留媒体语义：

```ts
type VideoInputAssets = {
  first_frame_asset_id?: string;
  last_frame_asset_id?: string;
  reference_asset_ids?: string[];
};
```

路由迁移期间，界面仍可发送兼容字段 `input_asset_ids`，但处理器必须完成规范化，不能丢失明确的首帧、尾帧角色。Worker 必须按用户和项目校验每个引用素材，再转换为供应商无关的输入结构：

```ts
type VideoProviderInput = {
  model: string;
  prompt: string;
  duration: number;
  width: number;
  height: number;
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceImages: string[];
};
```

New API 适配器把该中性结构映射到测试环境中实际验证过的网关契约。如果网关只支持一张图片，或没有公开首尾帧语义，任务必须以明确的能力错误失败，验收结果记为“后端能力缺失”；适配器不得静默把首帧和尾帧压缩成一张图片。

## 3. 测试驱动开发切片

1. 在路由处理器和 Worker 边界为显式首尾帧字段取得失败测试（RED）。
2. 为供应商请求体保真和 New API 响应规范化取得失败测试（RED）。
3. 只实现最小的字段规范化和适配器改动，使测试通过（GREEN）。
4. 为刷新水合和多任务独立恢复完成失败/通过测试（RED/GREEN）。
5. 为成功任务的素材水合和刷新后不变灰完成失败/通过测试（RED/GREEN）。
6. 获取浏览器、接口、数据库黑盒证据，再填写五态验收表。

每个行为变更都必须先展示失败测试，再修改生产代码。原先断言“视频只允许一张参考图”的测试，只能在首个 RED 周期中修改，并明确写出新行为。

## 4. 运行时验收步骤

1. 构建工作区 Node 包和打包后的 BullMQ Worker。
2. 启动 Redis 并验证 `PING`。
3. 启动 BullMQ Worker，并通过独立端口的 `GET /ready` 验证就绪状态。
4. 使用测试环境 New API 地址和测试数据库启动本地 Next 应用。
5. 在进程内使用给定测试账号登录，然后查询用量和模型列表；不得打印凭证。
6. 先跑上传流程，让图片、视频、音频素材及其 TOS URL 可用于后续引用，再执行付费生成。
7. 图片并发执行，视频串行执行；每个受控批次都检查请求、响应、任务、素材和刷新结果。

## 5. 验收证据

每一行必须记录浏览器结果、网络/接口结果、数据库任务/素材、刷新后行为，并且只能使用“完整”“接线缺失”“后端能力缺失”“仅假实现”“未验证”之一。只有单元测试通过时，不得标记为“完整”。
