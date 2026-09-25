/* ============================================
 * new-api 的**唯一出口**
 *
 * ── 为什么会有这个文件 ────────────────────────────────────────────────────────
 *
 * 在它之前，`NEW_API_BASE_URL` 被 **6 处各读各的**：
 *   · libs/core/new-api-transport.ts（ops 客户端，账单/管理端走这条）
 *   · libs/shared/text/completions.ts        （文生文，裸 fetch）
 *   · libs/shared/material/material.service.ts（素材库，裸 fetch）
 *   · libs/shared/generation/cost-estimator.service.ts
 *   · apps/.../agent-model-gateway.controller.ts（模块顶层读一次环境变量）
 *   · libs/shared/skills/skill-format.ts
 *
 * 于是「new-api 到底从哪进来」这个问题没有答案，只有六份各自的回答。它们的 base URL
 * 拼接、trace 头、超时/中断策略各不相同——改一处不会影响另一处，出问题要逐个排查。
 * 用户的原话是：「都调用一个接口，为啥写了 2 个，内部有收敛成一个出口吗」。
 *
 * ── 这个出口管什么、不管什么 ──────────────────────────────────────────────────
 *
 * **管**：base URL 解析（含缺失即拒绝）、路径拼接、`X-Trace-Id` 透传、发起请求。
 * 这几件事是纯重复，且漂移了没人会发现。
 *
 * **不管**：鉴权头与计费主体。因为 new-api 有**两套并存的鉴权模型**——
 *   · 用户面：`Authorization: Bearer <项目统一 key>`（NEW_API_UPSTREAM_KEY）
 *   · Agent 计费面：`Authorization: Bearer bwsvc_...` + `x-bw-subject-user-id`
 *     （服务令牌 + 计费主体矫正，见 agent-model-gateway 的说明）
 * 把鉴权塞进出口，就得让出口去分辨「这次是哪种调用」——那只是把分支换了个地方。
 *
 * ⚠️ 秒级流式（SSE）的**超时策略也不在这里**：文生文按总时长、Agent 网关按空闲时长，
 *    两者对「上游卡住」的定义本来就不同（见各自的注释）。出口只负责把 `signal` 透传下去。
 * ============================================ */
import { TRACE_ID_HEADER, getCurrentTraceId } from "@lib/core/logging";

export const NEW_API_BASE_URL_ENV = "NEW_API_BASE_URL";

/**
 * 上游地址未配置。
 *
 * <p>返回空串然后让调用方自己去处理，是本仓历史上多处踩过的坑：表现为
 * `fetch("undefined/v1/...")` 或一个来路不明的 404，报错点离原因很远。
 */
export class NewApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewApiConfigError";
  }
}

/** 上游 base URL（去掉尾部斜杠，避免拼出 `//v1`）。未配置即抛。 */
export function newApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env[NEW_API_BASE_URL_ENV] ?? "").trim();
  if (!raw) {
    throw new NewApiConfigError(`上游地址未配置（缺环境变量 ${NEW_API_BASE_URL_ENV}）`);
  }
  return raw.replace(/\/+$/, "");
}

/**
 * 拼一个上游 URL。
 *
 * @param path 以 `/` 开头的上游路径，例如 `/v1/chat/completions`
 */
export function newApiUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${newApiBaseUrl(env)}${path}`;
}

/**
 * 向上游发一个请求。
 *
 * <p>`X-Trace-Id` 由这里统一补（IKB29O）：调用方自己带了的以调用方为准——Agent 网关
 * 会把 Agent 发来的那个透传下去，那是同一条链路的延续，不该被我们本地生成的覆盖。
 *
 * @param init 调用方的原始 init。鉴权头等由调用方自己放进 `headers`
 */
export async function newApiFetch(
  path: string,
  init: RequestInit = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has(TRACE_ID_HEADER)) {
    const traceId = getCurrentTraceId();
    if (traceId) headers.set(TRACE_ID_HEADER, traceId);
  }
  return fetch(newApiUrl(path, env), { ...init, headers });
}
