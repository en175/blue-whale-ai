import { apiFetch } from "@/lib/api-client";

type AdminResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
  msg?: string;
  warning?: string;
};

/** 管理端统一请求入口：复用全站 token 注入与 401 失效处理。 */
export async function adminRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; warning?: string }> {
  const response = await apiFetch(url, init);
  const json = (await response.json()) as AdminResponse<T>;

  if (!response.ok || !json.success) {
    throw new Error(json.error ?? json.msg ?? `请求失败: ${response.status}`);
  }

  return {
    data: json.data as T,
    ...(json.warning ? { warning: json.warning } : {}),
  };
}

/** 在落盘管理会话前，由服务端实时确认该 token 确实属于管理员。 */
export async function verifyAdminAccess(token: string): Promise<void> {
  await adminRequest("/api/admin/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
}
