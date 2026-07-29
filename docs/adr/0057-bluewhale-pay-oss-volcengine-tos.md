# blue_whale_pay_server 对象存储弃阿里云、换火山引擎 TOS

## Context

`blue_whale_pay_server`(jeepay 整体搬运的支付平台,见 [0025](0025-payment-extension-via-blue-whale-pay.md))的 OSS 存储后端是 jeepay 自带的「本地 + 阿里云 OSS」抽象:`OssServiceTypeEnum`(LOCAL / ALIYUN_OSS)、`IOssService`(`upload2PreviewUrl` + `downloadFile`)、`OssSavePlaceEnum`(PUBLIC/PRIVATE 双桶)。三服务(payment/manager/merchant)默认 `service-type=local`。

oss 模块被实际使用,非死代码:
- **payment** `ChannelCertConfigKitBean`:支付渠道证书(微信 `apiclient_cert.p12` 等)落地存储 + `downloadFile` 拉回本地。
- **manager** `StaticController`:本地公共文件以 URL 暴露。
- **components-oss** `OssFileController`:`POST /api/ossFiles/{bizType}` 通用上传端点。

`blue_whale_server`(姊妹工程)的存储标准是**火山引擎 TOS**(`blue-whale-common-upload`,`com.volcengine:ve-tos-java-sdk`)。pay 与之统一存储后端,弃阿里云。

## Considered Options

- **替换后端实现,契约不变(选)**:保留 jeepay `IOssService` 契约 + `OssSavePlaceEnum`,新增 `VolcengineOssService` 顶替 `AliyunOssService`(`@ConditionalOnProperty(service-type=volc-tos)`)。TOS download 用 `getObjectV2`(参考 `TosGenerationStorage`)。不波及 `ChannelCertConfigKitBean`/`OssFileController`,改动面最小,符合 jeepay「存储后端可切换」抽象原意。
- **整体替换 oss 模块**:删 jeepay `components-oss` 换参考 `blue-whale-common-upload`(`AbstractStorageService` 仅 upload)。但参考实现缺 download + public/private,需改支付证书流程 + 上传端点,割裂 jeepay 框架,回归风险高。
- **阿里云与火山并列**:留 `AliyunOssService` 作备选,`VolcengineOssService` 并列。冗余死代码,与「换」的目标相悖。

## Decision

**替换后端实现,契约不变;彻底删阿里云;过渡期复用 sweet-oa 桶**。

1. **删阿里云**:`AliyunOssService` + `AliyunOssYmlConfig` + `ALIYUN_OSS` 枚举 + `aliyun-sdk-oss` pom 依赖 + 四套 yml `aliyun-oss` 段。
2. **新增火山**:`VolcengineOssService`(`TOSV2` 客户端,upload `putObject` + download `getObjectV2` 写本地)+ `VolcengineOssYmlConfig`(prefix=`isys.oss.volcengine-tos`)+ `VOLC_TOS("volc-tos")` + `ve-tos-java-sdk:2.6.6`。
3. **双桶结构保留**:`OssSavePlaceEnum` PUBLIC/PRIVATE 语义不变(镜像 `AliyunOssService` 分支:PUBLIC 返 `domain/key` 完整 URL,PRIVATE 返相对路径)。
4. **过渡期桶策略**:生产前火山未建 pay 专用双桶,过渡期 `public-bucket-name`/`private-bucket-name` 都填 `sweet-oa`(`blue_whale_server` 在用),用 `prefix=bluewhale-pay` + `public/`/`private/` 子路径隔离业务文件与 OA 文件;生产建专用双桶后改环境变量即可,代码零改。
5. **凭证走环境变量**:`access-key=${TOS_ACCESS_KEY}` / `secret-key=${TOS_SECRET_KEY}` / 桶名/endpoint/domain/region/prefix 均 `${TOS_*}` 占位,绝不写死明文。
6. **`service-type=volc-tos` 为默认**(三服务 committed yml)。

## Consequences

- **本地 dev/CI 跑三服务须先配 `TOS_*` 环境变量**,否则 `VolcengineOssService` 初始化失败启动不起来;免 env 本地跑可临时 `service-type` 改回 `local`(`LocalFileService` 保留)。
- **过渡期安全**:sweet-oa 是公共读桶,`bluewhale-pay/private/` 下文件**可被 URL 访问**——支付证书过渡期勿传真实证书,用假证书测 download 通路;生产建私有桶后再放真证书。
- **生产迁移**:建 pay 专用 public/private 双桶,改 `TOS_PUBLIC_BUCKET`/`TOS_PRIVATE_BUCKET` 环境变量即可,代码零改。
- **凭证不进仓**:真实 AK/SK 只在环境变量,committed yml 仅占位(对齐 [ADR-0010](0010-local-master-is-user-integration-zone.md) 不提交本地凭证的精神)。
- **jeepay 抽象保留**:`LocalFileService` + `IOssService` 契约不变,未来可继续加其他后端。

## 验证(2026-07-28)

- ✅ **编译**:`mvn clean compile` 全 9 模块 SUCCESS,`blue-whale-pay-components-oss` 含新 `VolcengineOssService`/`VolcengineOssYmlConfig`,`ve-tos-java-sdk:2.6.6` 依赖解析正常。
- ✅ **无残留**:`AliyunOss`/`ALIYUN_OSS`/`com.aliyun.oss` 全仓无残留(mq 模块的 `com.aliyun.*` 是 AliYun RocketMQ,不受影响)。
- ✅ **Code Review**(两轴,2026-07-28):Standards 无硬规范违反(仅 minor nits:`VolcengineOssService.trimSlash`/`trimEndSlash` 可合并、`log.error("error",e)` 信息量不足,均继承自 `AliyunOssService` 写法);Spec 无缺失/无多余改动/无回归——`IOssService` 契约不变,`ChannelCertConfigKitBean`/`OssFileController`/`StaticController`/`LocalFileService` 全调用方验证安全。
- ✅ **TOS 连通性**(2026-07-28):临时 `TosVerify`(反射注入 `VolcengineOssYmlConfig` + 调 `init`/`upload2PreviewUrl`/`downloadFile`)直连 `bluewhale-assets` 私有桶(`cn-beijing`),PRIVATE upload + download 通路 + 内容一致 `RESULT=PASS`。实际部署桶 `bluewhale-assets`(env `TOS_PRIVATE_BUCKET` 覆盖 committed 默认 `sweet-oa`)。验证产物已清理、不进 PR;凭证走环境变量、不入库。
- ⏳ **三服务集成**:payment 真实启动 + `ChannelCertConfigKitBean` 证书上传/下载流程,待合并后在完整环境(MySQL/Redis/RocketMQ)验证。
