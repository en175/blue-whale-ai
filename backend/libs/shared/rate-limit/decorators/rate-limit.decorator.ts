import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "rateLimit";

export type RateLimitKey = "ip" | "account" | "phone" | "user";

export type RateLimitBucket = {
  scope: string;
  key: RateLimitKey;
  limit: number;
  windowMs: number;
};

export type RateLimitOptions = {
  buckets: RateLimitBucket[];
};

export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
