/**
 * auth fixture —— 用 page.addInitScript 注入 bw-user 到 localStorage，
 * 绕过 AuthProvider 的 loadUser() gate，避开 LoginModal 流程。
 *
 * addInitScript 在任何页面 JS 之前执行（每个 navigation 都会重跑），
 * 与 authStorage.ts:9 的 USER_KEY = "bw-user" 保持一致。
 *
 * 注意：seed 值均为占位，App 不校验其真实性；userId 必须存在
 * （authStorage.ts 的 loadUser() 缺少 userId 会判为未登录）。
 */
import type { Page } from "@playwright/test";

export const SEED_USER = {
  userId: 1,
  username: "e2e",
  phone: "13800000000",
} as const;

export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((user) => {
    window.localStorage.setItem("bw-user", JSON.stringify(user));
  }, SEED_USER);
}
