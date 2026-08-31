import { z } from "zod";

// IKBRCK：修改密码请求体契约。字段随网关 PUT /api/user/self（original_password/password）。
// 新密码长度口径：网关（blue-whale-api，事实源）强制 8–20，BFF 透传不二次校验；
// 前端文案/前端任务 IKBRCI 须与 8–20 对齐，不以工单初稿的 9–20 为准。
export const changePasswordRequestSchema = z
  .object({
    // 原密码 trim 后再判非空：纯空白原密码视为未提供（对齐旧 controller 的 trim 行为）。
    original_password: z.string().trim().min(1),
    // 新密码不 trim——密码可合法含首尾空格，只要求非空（长度口径 8–20 由网关兜底）。
    password: z.string().min(1),
  })
  .strict();

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
