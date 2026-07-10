/**
 * api —— 公共入口（IJZYVR API 客户端骨架）
 *
 * 消费方用法:
 *   import { getMe, startGeneration, ApiError, isApiError } from "@/lib/api";
 *
 * 不暴露 client 的 `apiFetch`（避免绕过 header/错误处理直接调 fetch）;
 * 消费方只走 endpoint 函数 + 类型 + 错误类。
 */

export * from "./errors";
export * from "./userId";
export * from "./dto";
export * from "./endpoints";
