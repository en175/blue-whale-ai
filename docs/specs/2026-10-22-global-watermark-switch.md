# 全项目 AI 生成水印开关（system_settings.watermark）

- **日期**：2026-10-22
- **状态**：定稿
- **关联**：[ADR-0131](../adr/0131-low-frequency-config-in-system-settings.md)（低频明文配置入 `system_settings`）

## 一、配置

| 项 | 值 |
|---|---|
| 存储 | `system_settings`，`setting_key = 'watermark'`，`is_secret = 0` |
| 值 | `{"enabled": boolean}` |
| 缺省 | 行不存在 / `enabled` 非布尔 → 关闭（保持现状） |
| 写入口 | 管理端「通用设置 → 生成水印」→ `PUT /api/admin/settings` 的 `{watermark:{enabled}}` |

这是全项目唯一的水印开关。admin（NestJS）读写该行；worker-java 每次向上游提交生成请求时现查该行
（`SystemSettingMapper.selectValue("watermark")`），改完立即对之后执行的请求生效。

## 二、生效范围

| 媒介 / 路径 | 出站字段 | 行为 |
|---|---|---|
| 图片 · Seedream（`seedream-image`，inline `/v1/images/generations`） | 顶层 `watermark: true` | 开关开启时下发；关闭时完全不传 |
| 图片 · `gpt-image`（内联）/ `banana-image` | — | 不接（上游协议未验证/忽略） |
| 图片 · `gpt-image-openai`（官方 OpenAI Images） | — | 永不下发；带 `watermark` 会被上游 400 |
| 视频 · submit（含样片 `draft`） | `body.metadata.watermark: true` | 开关开启时下发 |
| 视频 · finalize（样片成片） | 顶层 `body.watermark: true` | 开关开启时下发（finalize 不认 metadata） |
| 音频 · seed-audio | — | 不接：`watermark` 是对象协议（`aigc_watermark`），不是布尔位 |
| MediaKit 后处理（抠图/擦除/增强等） | — | 不接：没有「AI生成」标识能力 |

**只增不减**：开启时写 `true`，关闭时不写该字段。若上游自身默认加水印，本开关无法去掉。

## 三、失败与并发语义

- **admin 读**：`watermark` 行 JSON 损坏 → 整个 `GET /api/admin/settings` 失败（与 `policy` / `rateLimit` 一致，fail loud）。
- **worker 读**：行缺失、JSON 损坏、字段非布尔、读库异常 → 按关闭处理并记 WARN，不阻断生成。
- **行损坏无法从管理端自愈**：`update()` 会先读当前值。需要人工用 SQL 改写或删除 `watermark` 行。
- **现查而非冻结**：开关按「每次上游提交」读取，不冻结进 `job.input`。因此一次多图任务在开关切换瞬间
  可能部分图带水印、部分不带；样片与成片之间切换开关也可能不一致。这是有意选择，换取改完即生效。

## 四、发布顺序

1. 先上 backend（旧 backend 不认识 `watermark` 模块，会 400；新 web 配旧 backend 会导致整个设置页保存失败）。
2. worker-java 可随时上：行缺失 = 关闭。
3. 最后上 web。

上线后默认关闭，需运营在管理端手动打开；打开前建议先用真实网关生成一条 Seedream 图片/视频，确认上游实际加标。

## 五、代码落点

- 配置读写：`backend/libs/shared/system-settings/system-settings.service.ts`、`backend/apps/blue-whale/src/api/admin/settings.controller.ts`
- 管理端：`web/src/admin/pages/SystemConfig/index.tsx`、`web/src/admin/api/adminSettings.ts`
- worker 读取：`server/blue-whale-worker/src/main/java/com/bluewhale/worker/infrastructure/config/GenerationWatermarkConfig.java`
- 出站：`.../infrastructure/gateway/NewApiImageClient.java`、`.../NewApiVideoClient.java`；渠道支持位在 `ImageJobProcessor`（仅 `seedream-image`）
