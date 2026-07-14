import { apiRequest } from "./api-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const FETCH_TIMEOUT = 10000;

export interface CaptchaResult {
  captcha_token: string;
  captcha_image: string;
}
export interface SendCodeResult {
  success: boolean;
  expires_in: number;
}
export interface LoginData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  username: string;
  phone: string;
  avatar?: string;
  is_new_user: boolean;
}
export interface UserInfo {
  user_id: number;
  username: string;
  phone: string;
  avatar?: string;
}

interface ApiResult<T> {
  code: number;
  msg: string;
  success: boolean;
  data: T;
}

export class ApiError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 仅用于 auth 端点（login/refresh/captcha/send-code），不走 401 拦截。 */
async function getResult<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(`${API_BASE}${url}`, options, FETCH_TIMEOUT);
  if (!res.ok) {
    throw new ApiError(`请求失败: ${res.status}`, res.status);
  }
  const result = (await res.json()) as ApiResult<T>;
  if (!result || result.code !== 200) {
    throw new ApiError(result?.msg ?? "接口返回失败", result?.code);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// 公开 auth 端点（不走 401 拦截，避免无限循环）
// ---------------------------------------------------------------------------

/** 获取图形验证码 */
export function fetchCaptcha(): Promise<CaptchaResult> {
  return getResult<CaptchaResult>("/api/auth/captcha");
}

/** 发送短信验证码 */
export function sendVerificationCode(phone: string, captchaToken: string, captchaAnswer: string): Promise<SendCodeResult> {
  return getResult<SendCodeResult>("/api/auth/send-code", {
    method: "POST",
    body: JSON.stringify({ phone, captcha_token: captchaToken, captcha_answer: captchaAnswer }),
  });
}

/** 登录/注册 */
export function loginWithCode(phone: string, code: string): Promise<LoginData> {
  return getResult<LoginData>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

/** 刷新 token（由 api-client 内部直接 fetch，外部一般不直接调）。 */
export function refreshToken(refreshToken: string): Promise<LoginData> {
  return getResult<LoginData>("/api/auth/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshToken}` },
  });
}

/** 登出 */
export function logoutApi(refreshToken: string): Promise<void> {
  return getResult<void>("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshToken}` },
  });
}

// ---------------------------------------------------------------------------
// 需鉴权的端点（走 apiRequest → 401 自动刷新 → 自动重试）
// ---------------------------------------------------------------------------

/** 获取当前用户 */
export function fetchMe(): Promise<UserInfo> {
  return apiRequest<UserInfo>("/api/me");
}

/** 更换手机号——发验证码 */
export function sendChangePhoneCode(newPhone: string, captchaToken: string, captchaAnswer: string): Promise<SendCodeResult> {
  return apiRequest<SendCodeResult>("/api/user/phone/send-code", {
    method: "POST",
    body: JSON.stringify({ new_phone: newPhone, captcha_token: captchaToken, captcha_answer: captchaAnswer }),
  });
}

/** 更换手机号——校验验证码 */
export function changePhone(newPhone: string, code: string): Promise<void> {
  return apiRequest<void>("/api/user/phone", {
    method: "PUT",
    body: JSON.stringify({ new_phone: newPhone, code }),
  });
}

/** 更新用户名 */
export function updateUsername(username: string): Promise<void> {
  return apiRequest<void>("/api/user/username", {
    method: "PUT",
    body: JSON.stringify({ username }),
  });
}

/** 上传头像 */
export async function uploadAvatar(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<{ url: string }>("/api/user/avatar", {
    method: "PUT",
    body: formData,
  });
}
