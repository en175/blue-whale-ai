/**
 * 主 API 共享结构化 logger（IK9RSS）。
 *
 * 整个 backend/apps/blue-whale 及其 libs/ 共用此实例。
 * 传给 createLogger 的是**模块名**，逐行作为 logger_name 带出去；服务名是进程级常量
 * （见 packages/core/src/logger.ts 的 setLogServiceName），不再由这里或环境变量决定。
 * 日志同时写 stdout（JSON 行）和火山 TLS（配置不全时自动 noop）。
 */
import { createLogger } from "@lib/core/logging";

export const logger = createLogger("blue-whale");
