/**
 * auth fixture —— 用 page.addInitScript 注入 bw-user 到 localStorage，
 * 绕过 AuthProvider 的 loadUser() gate，避开 LoginModal 流程。
 *
 * addInitScript 在任何页面 JS 之前执行（每个 navigation 都会重跑），
 * 与 authStorage.ts:9 的 USER_KEY = "bw-user" 保持一致。
 *
 * 注意：seed 的 username/phone 是占位值，App 不会校验其真实性 —— 仅需非空 string。
 */
import type { Page } from "@playwright/test";

export const SEED_USER = {
  username: "e2e",
  phone: "13800000000",
} as const;

export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((user) => {
    window.localStorage.setItem("bw-user", JSON.stringify(user));
  }, SEED_USER);
}
