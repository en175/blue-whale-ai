
export function agentServiceBaseUrl(): string {
  return process.env.AGENT_SERVICE_BASE_URL?.trim() || "http://localhost:4111";
}

export function agentServiceToken(): string {
  return process.env.AGENT_SERVICE_TOKEN?.trim() || "";
}

export function agentTenantId(): string {
  return process.env.AGENT_TENANT_ID?.trim() || "default";
}
