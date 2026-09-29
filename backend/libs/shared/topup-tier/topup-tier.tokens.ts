/**
 * 档位 repo 的 DI token。
 *
 * <p>放在领域目录、而不是 `topup-tier.module.ts` 里：token 是「**谁**被注入」的名字，
 * 模块才是「**谁**提供」。这样消费方（service / controller）永远不必 import 一个
 * `.module.ts` —— 模块是装配根的产物，领域服务依赖它是分层倒置。
 *
 * <p>与 `GRANT_RETRY_WINDOW_MS_TOKEN` 同一路数（那个在 `recharge-grant-sweeper.ts`，
 * provider 在 `recharge.module.ts`）。
 *
 * <p>也不放进 `persistence/`：那一层**会被容器外消费**（`scripts/reconcile-cost-reservations.mjs`
 * 等直接在裸 node 下 import 它的 dist），DI 词汇不该渗进去。
 */
export const TOPUP_TIER_REPO_TOKEN = Symbol("TOPUP_TIER_REPO");
