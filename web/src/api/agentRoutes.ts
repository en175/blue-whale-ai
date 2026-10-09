import contract from './agent-rest-routes.v1.json';

interface AgentRestRoute {
  name: string;
  method: string;
  path: string;
}

export const AGENT_ROUTES: AgentRestRoute[] = contract.routes;

const NAMESPACE = '/api/agent/v1';

export function agentUrl(
  name: string,
  projectId: string,
  params: Record<string, string | number> = {},
): string {
  const route = AGENT_ROUTES.find((entry) => entry.name === name);
  if (!route) throw new Error(`未知的 agent 路由：${name}`);
  const tail = route.path.replace(/\{([a-z_]+)\}/g, (_m, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`agent 路由 ${name} 缺少参数 ${key}`);
    return encodeURIComponent(String(value));
  });
  return `${NAMESPACE}/projects/${encodeURIComponent(projectId)}${tail}`;
}

export function agentMethod(name: string): string {
  const route = AGENT_ROUTES.find((entry) => entry.name === name);
  if (!route) throw new Error(`未知的 agent 路由：${name}`);
  return route.method;
}

export function agentPath(
  name: string,
  projectId: string,
  params: Record<string, string | number> = {},
): string {
  return agentUrl(name, projectId, params).slice(NAMESPACE.length);
}
