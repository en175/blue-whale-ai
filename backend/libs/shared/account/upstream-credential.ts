import { NewApiError } from "@lib/core";

/**
 * 上游（new-api）执行凭证 —— **项目级统一 key**。
 *
 * <h2>它替换掉了什么</h2>
 *
 * 过去每个用户在 new-api 那边有自己的账号，登录拿回他自己的 `sk-`，
 * 会话把它存进 Redis，Guard 每请求回注给下游代打 new-api。**一用户一把 key。**
 *
 * <p>new-api 独立成上游供应商之后，那边不再有我们的用户，改成发给我们**一把统一的 key**。
 * 于是这把 key 的性质变了：它不再是「某个人的登录产物」，而是**部署配置**——
 * 和 `NEW_API_BASE_URL` 同级，全进程一份。
 *
 * <h2>为什么单独一个文件</h2>
 *
 * 「上游凭证从哪来」这件事在过渡期只有**一个**答案，而这个答案将来还会再变
 * （见下）。把读取点收在一处，届时改动是一个文件而不是一次全局搜索。
 *
 * <p>⚠️ **过渡态**：`identity.proto` 的 `VerifySessionResponse` 里没有凭证字段，
 * 说明目标形态是应用层服务之间互认（服务身份 + 短时令牌），而不是把上游 key
 * 传给每个服务。到那一步时本文件整体删除，而不是继续加分支。
 *
 * <h2>配置缺失时怎么办：拒绝，不降级</h2>
 *
 * 没配 key 就用空串继续跑，会让下游拿 `Bearer ` 去打 new-api 然后收到 401——
 * 报错点在离原因很远的地方，排查要绕一大圈。这里当场抛，并指名道姓说缺哪个变量。
 */
export const UPSTREAM_KEY_ENV = "NEW_API_UPSTREAM_KEY";

/** 上游凭证未配置。与「凭证被上游拒绝」是两回事，不要混成一个 401。 */
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
 * 读取上游统一 key。
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
