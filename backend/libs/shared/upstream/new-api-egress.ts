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
 * **管**：base URL 解析（含缺失即拒绝）、**项目统一凭证**（{@link resolveUpstreamCredential}）、
 * 路径拼接、`X-Trace-Id` 透传、发起请求。这几件事是纯重复，且漂移了没人会发现。
 *
 * **不管**：把鉴权**头**塞进请求，也不判别计费主体。因为 new-api 有**两套并存的鉴权模型**，
 * 由调用方按自己的语义各取所需：
 *   · 用户面：`Authorization: Bearer <resolveUpstreamCredential()>` —— 项目级统一 key
 *   · Agent 计费面：`Authorization: Bearer bwsvc_...` + `x-bw-subject-user-id`
 *     （服务令牌 + 计费主体矫正，见 agent-model-gateway 的说明）
 * 把「填哪个头」塞进出口，就得让出口去分辨「这次是哪种调用」——那只是把分支换了个地方。
 *
 * ⚠️ **计费面的 `bwsvc_` 服务令牌不是「第二把项目 key」**，不要试图把它并进统一 key：
 *    new-api 的 relay 入口**按前缀分流**（`middleware/relay_auth.go`）——不带的落
 *    `TokenAuth` 查 token 表，带的落 `AgentBillingAuth` 做恒时比对并解出计费主体。
 *    换成 `sk-` 统一 key 不是报错，是**静默换一条路**：走到 `TokenAuth`，账单记到统一 key
 *    的属主头上，`x-bw-subject-user-id` 被无视。它是**服务身份**，与项目凭证不同轴。
 *
 * ⚠️ 秒级流式（SSE）的**超时策略也不在这里**：文生文按总时长、Agent 网关按空闲时长，
 *    两者对「上游卡住」的定义本来就不同（见各自的注释）。出口只负责把 `signal` 透传下去。
 * ============================================ */
import { NewApiError } from "@lib/core";
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

/* ────────────────────────────────────────────────────────────────────────────
 * 项目统一凭证
 *
 * **项目里只能有一把上游凭证**，就是这把 —— `NEW_API_UPSTREAM_KEY`。
 * 所有以「蓝鲸自己」身份打 new-api 的调用都用它（登录签发会话、文生文的兜底、
 * 技能格式化……）。它不管是哪个用户在操作、也不管调的是哪个模型。
 *
 * <p>与之并列的 `bwsvc_` 服务令牌**不是第二把项目 key**——它是 Agent 计费面的
 * **服务身份**，走 new-api 的另一套鉴权模型（按前缀分流的 `AgentBillingAuth`），
 * 换成统一 key 会静默把账记到别人头上。见文件头那段说明。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 项目统一 key 的环境变量名。 */
export const UPSTREAM_KEY_ENV = "NEW_API_UPSTREAM_KEY";

/**
 * 上游凭证未配置。
 *
 * <p>与「凭证被上游拒绝」是两回事，不要混成一个 401：那是配置缺失（503，该找运维），
 * 这是上游不认（401，该查凭证本身）。
 */
export class UpstreamCredentialMissingError extends NewApiError {
  constructor() {
    super(
      `上游凭证未配置（缺环境变量 ${UPSTREAM_KEY_ENV}）：new-api 已改为项目级统一 key，` +
        `需由部署注入`,
      503,
      "upstream_credential_missing",
    );
    this.name = "UpstreamCredentialMissingError";
  }
}

/**
 * 读取项目统一 key。
 *
 * <h2>它替换掉了什么</h2>
 *
 * 过去每个用户在 new-api 那边有自己的账号，登录拿回他自己的 `sk-`，会话把它存进 Redis，
 * Guard 每请求回注给下游代打 new-api。**一用户一把 key。**
 *
 * <p>new-api 独立成上游供应商之后，那边不再有我们的用户，改成发给我们**一把统一的 key**。
 * 于是这把 key 的性质变了：它不再是「某个人的登录产物」，而是**部署配置**——和
 * {@link NEW_API_BASE_URL_ENV} 同级，全进程一份，多配一处就是多一处轮换与漂移。
 *
 * <h2>为什么读取点收在出口里</h2>
 *
 * 「new-api 从哪进来」和「以谁的身份进来」是两个半边，答案都只有一个。分开放在两个模块
 * 里，就又是「各答一半」——出口的存在正是为了终结那种局面。
 *
 * <p>⚠️ **过渡态**：`identity.proto` 的 `VerifySessionResponse` 里没有凭证字段，说明目标
 * 形态是应用层服务之间互认（服务身份 + 短时令牌），而不是把上游 key 传给每个服务。
 * 到那一步时这个函数整体删除，而不是继续加分支。
 *
 * @throws UpstreamCredentialMissingError 未配置或为空白
 */
export function resolveUpstreamCredential(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = (env[UPSTREAM_KEY_ENV] ?? "").trim();
  if (!key) {
    throw new UpstreamCredentialMissingError();
  }
  return key;
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
