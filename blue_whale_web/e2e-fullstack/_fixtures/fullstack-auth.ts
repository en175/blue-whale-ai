/**
 * 全栈验收认证与产品权威 fixture（IK1NS2）
 *
 * 测试认证契约：经 Web → Next rewrite → Gateway → User Service 调 /api/auth/login，
 * 使用 AuthService 硬编码测试号 15079999999（任意 6 位验证码）换取服务端签发的真实 JWT，
 * 再种子到 localStorage（与 authStorage.ts 三键一致）。不伪造身份、不写死凭据到产物。
 *
 * 所有 API 断言同样经 Web rewrite → Gateway，以 Project Snapshot 为产品权威。
 */
import { request, type APIRequestContext, type Page } from "@playwright/test";

export const TEST_PHONE = "15079999999";
export const TEST_CODE = "123456";

export interface FullstackSession {
  accessToken: string;
  refreshToken: string;
  userId: number;
  username: string;
  phone: string;
}

export async function loginViaApi(baseURL: string): Promise<FullstackSession> {
  const ctx = await request.newContext({ baseURL });
  try {
    const res = await ctx.post("/api/auth/login", {
      data: { phone: TEST_PHONE, code: TEST_CODE },
    });
    if (!res.ok()) {
      throw new Error(`测试登录失败：${res.status()} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      data: {
        access_token: string;
        refresh_token: string;
        user_id: number | string;
        username: string;
        phone: string;
      };
    };
    return {
      accessToken: body.data.access_token,
      refreshToken: body.data.refresh_token,
      userId: Number(body.data.user_id),
      username: body.data.username,
      phone: body.data.phone,
    };
  } finally {
    await ctx.dispose();
  }
}

/** 种子登录态三键（bw-user / bw-access-token / bw-refresh-token），使前端进入后端模式。 */
export async function seedSession(
  page: Page,
  session: FullstackSession,
): Promise<void> {
  await page.addInitScript((s) => {
    window.localStorage.setItem(
      "bw-user",
      JSON.stringify({
        userId: s.userId,
        username: s.username,
        phone: s.phone,
      }),
    );
    window.localStorage.setItem("bw-access-token", s.accessToken);
    window.localStorage.setItem("bw-refresh-token", s.refreshToken);
  }, session);
}

/** 带 Bearer 的 API 断言客户端；请求经 Web rewrite → Gateway，与浏览器同路径。 */
export function bearerClient(
  baseURL: string,
  session: FullstackSession,
): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${session.accessToken}` },
  });
}

// ---- Project Snapshot（产品权威，snake_case 与 SnapshotResponse 对齐）----

export interface SnapshotInputRequest {
  input_request_id: number | string;
  request_type: string;
  question: string;
  status: string;
}

export interface SnapshotAgentRun {
  agent_run_id: number | string;
  status: string;
  active_input_request?: SnapshotInputRequest | null;
}

export interface SnapshotGenerationJob {
  job_id: number | string;
  agent_run_id?: number | string | null;
  source: string;
  status: string;
  retry_of_job_id?: number | string | null;
  input?: { prompt?: string };
  error?: { code?: string; message?: string } | null;
  output_asset_ids?: Array<number | string>;
  outputs?: Array<{
    slot_index: number;
    status: string;
    asset_id?: number | string | null;
    error?: { message?: string } | null;
  }>;
}

export interface ProjectSnapshot {
  conversation_messages: Array<{
    message_id: number | string;
    role: string;
    content: string;
  }>;
  agent_runs: SnapshotAgentRun[];
  generation_jobs: SnapshotGenerationJob[];
  assets: Record<
    string,
    { asset_id: number | string; access_url?: string; type?: string }
  >;
  canvas?: { nodes?: string; viewport?: string } | null;
}

export async function fetchSnapshot(
  api: APIRequestContext,
  projectId: number | string,
): Promise<ProjectSnapshot> {
  const res = await api.get(`/api/projects/${projectId}/snapshot`);
  if (!res.ok()) {
    throw new Error(`snapshot 获取失败：${res.status()} ${await res.text()}`);
  }
  return ((await res.json()) as { data: ProjectSnapshot }).data;
}
