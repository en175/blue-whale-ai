/**
 * 主 API 共享结构化 logger（IK9RSS）。
 *
 * 整个 backend/apps/blue-whale 及其 libs/ 共用此实例。
 * container 缺省 "blue-whale"，可被 CONTAINER_NAME 环境变量覆盖。
 * 日志同时写 stdout（JSON 行）和火山 TLS（配置不全时自动 noop）。
 */
import { createLogger } from "@blue-whale/core/logging";

export const logger = createLogger("blue-whale");
