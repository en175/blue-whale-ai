import { Global, Module } from "@nestjs/common";
import { LoginFailureTracker } from "./login-failure-tracker.js";
import { RateLimitAllowlist } from "./rate-limit-allowlist.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimiter } from "./rate-limiter.js";

@Global()
@Module({
  providers: [RateLimiter, LoginFailureTracker, RateLimitAllowlist, RateLimitGuard],
  exports: [RateLimiter, LoginFailureTracker, RateLimitAllowlist, RateLimitGuard],
})
export class RateLimitModule {}
