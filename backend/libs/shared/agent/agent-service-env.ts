/**
 * 连上游 agent 服务要的三个环境变量，一处定义。
 *
 * 此前 `agent-v1-proxy.controller.ts` 与 `agent-session-credits.controller.ts` 各有一份逐字
 * 相同的副本，连 `localhost:4111` 和 `"default"` 两个缺省值都一样（审查 W·S3）。这类复制的
 * 代价不是多几行，是改一处漏一处：换端口、换租户标签时，编译器不会告诉你还有第二份。
 *
 * <p>⚠️ 它住在 `libs/` 而**不是** `apps/`：`libs/shared/canvas/prompt-preview.ts` 也要用它，
 * 而共享包向上依赖应用是条反向边——包不能单独构建、单独测试，也搬不走。
 * 两个应用侧控制器改为向这里 import（方向是 app → lib）。
 */

/** 上游 agent 服务地址（独立 blue-whale-agent 服务）。缺省 localhost:4111。 */
export function agentServiceBaseUrl(): string {
  return process.env.AGENT_SERVICE_BASE_URL?.trim() || "http://localhost:4111";
}

/** agent 服务凭证（agent trustedContext 校验 `Bearer ${AGENT_SERVICE_TOKEN}`），与 agent 侧 .env 保持一致。 */
export function agentServiceToken(): string {
  return process.env.AGENT_SERVICE_TOKEN?.trim() || "";
}

/** 蓝鲸为单租户产品：tenant 是固定标签；agent 侧按 (tenant, principal) 隔离。 */
export function agentTenantId(): string {
  return process.env.AGENT_TENANT_ID?.trim() || "default";
}
