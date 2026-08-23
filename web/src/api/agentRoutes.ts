/**
 * Agent 接口地址的唯一构造入口（IKACK2）。
 *
 * 这个文件存在的理由很具体：此前这里的每个请求地址都是手写的模板字符串，其中取消和重试
 * 多写了一段 `/sessions/:sid`——agent 的 Run 级路由与 sessions **平级**而非其子路径。
 * 两个仓库之间没有共享类型也没有生成的客户端，编译器看不见这个错，于是那两个按钮
 * 在很长一段时间里每次点击都打在 404 上，而界面照常显示"已停止"。
 *
 * 所以这里不再暴露任何拼路径的能力：地址来自 agent 仓生成的清单副本，调用方只能报一个
 * 路由名和参数。**写不出错误的地址，才是这个问题真正的解法**——地址表能挡住"对面改了这边
 * 没跟上"，挡不住"新加端点时又手写错一个"。
 *
 * 副本从哪来：agent 仓 `pnpm contract:routes` 生成 `contracts/agent-rest-routes.v1.json`，
 * 原样拷到这里。副本是否过期，两边本地都证明不了；agent 提供 `GET /v1/routes` 返回活的
 * 清单，用 `npm run check:agent-routes` 与线上比对。
 */
import contract from './agent-rest-routes.v1.json';

/** 清单里一条路由的形状。只给 AGENT_ROUTES 标类型，不对外——外部只该按路由名取地址。 */
interface AgentRestRoute {
  name: string;
  method: string;
  path: string;
}

export const AGENT_ROUTES: AgentRestRoute[] = contract.routes;

/** BFF 命名空间。agent 侧收到的是剥掉这一段之后的路径。 */
const NAMESPACE = '/api/agent/v1';

/**
 * 拼出一个完整的请求地址。
 *
 * `projectId` 单独入参而非放进 `params`：它是所有产品路由的公共前缀（`base_path`），
 * 不属于任何一条路由自己的形状。
 */
export function agentUrl(
  name: string,
  projectId: string,
  params: Record<string, string | number> = {},
): string {
  const route = AGENT_ROUTES.find((entry) => entry.name === name);
  // 抛而不是兜底：地址错了应该在第一次调用时炸开，而不是变成一个安静的 404——
  // 上一次正是"安静的 404"让这个问题活了下来。
  if (!route) throw new Error(`未知的 agent 路由：${name}`);
  const tail = route.path.replace(/\{([a-z_]+)\}/g, (_m, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`agent 路由 ${name} 缺少参数 ${key}`);
    return encodeURIComponent(String(value));
  });
  return `${NAMESPACE}/projects/${encodeURIComponent(projectId)}${tail}`;
}

/** 只要相对 agent 的那一段（`sessionRequest` 自带 `/api/agent/v1` 前缀）。 */
export function agentPath(
  name: string,
  projectId: string,
  params: Record<string, string | number> = {},
): string {
  return agentUrl(name, projectId, params).slice(NAMESPACE.length);
}
