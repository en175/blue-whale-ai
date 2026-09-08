import { Global, Module } from "@nestjs/common";
import { LoginFailureTracker } from "./login-failure-tracker.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimiter } from "./rate-limiter.js";

/** 限流单例 + 失败锁定；Guard 由 AppModule 注册为 APP_GUARD。 */
@Global()
@Module({
  providers: [RateLimiter, LoginFailureTracker, RateLimitGuard],
  exports: [RateLimiter, LoginFailureTracker, RateLimitGuard],
})
export class RateLimitModule {}
