/**
 * IKACK2。这一组守的是「地址只能来自清单」这条规矩本身。
 *
 * agentSessions.test.ts 那张地址表能挡住「agent 改了路由而这边没跟上」，挡不住
 * 「新加端点时又手写错一个新地址」——表和客户端是同一个人照同一份文档写的，写错了两边一起错。
 * 所以真正的解法不是多一张表，而是让手写路径这件事从代码里消失，由下面的源码守卫盯着。
 */
import { describe, expect, it } from 'vitest';
import { AGENT_ROUTES, AGENT_ROUTES_VERSION, agentPath, agentUrl } from './agentRoutes';

describe('agentUrl', () => {
  it('按清单拼地址，并补上 BFF 命名空间与 project 前缀', () => {
    expect(agentUrl('cancel_session', 'p1', { session_id: 's1' })).toBe(
      '/api/agent/v1/projects/p1/sessions/s1/cancel',
    );
  });

  it('Run 级路由不带 sessions 段——此前正是这里错的', () => {
    expect(agentUrl('cancel_run', 'p1', { run_id: 'r1' })).toBe('/api/agent/v1/projects/p1/runs/r1/cancel');
    expect(agentUrl('retry_run', 'p1', { run_id: 'r1' })).toBe('/api/agent/v1/projects/p1/runs/r1/retry');
  });

  it('参数逐个转义，id 来自面向用户的系统', () => {
    expect(agentUrl('session_snapshot', 'p 1', { session_id: 'a/b' })).toBe(
      '/api/agent/v1/projects/p%201/sessions/a%2Fb/snapshot',
    );
  });

  it('路由名不存在就抛，而不是拼出一个安静的 404', () => {
    // 上一次正是「安静的 404」让取消失效这么久没被发现。
    expect(() => agentUrl('no_such_route', 'p1')).toThrow(/未知的 agent 路由/);
  });

  it('少给参数也抛，不容忍拼出带 {} 的地址', () => {
    expect(() => agentUrl('cancel_run', 'p1')).toThrow(/缺少参数 run_id/);
  });

  it('agentPath 去掉命名空间，交给 sessionRequest 补', () => {
    expect(agentPath('cancel_run', 'p1', { run_id: 'r1' })).toBe('/projects/p1/runs/r1/cancel');
  });
});

describe('清单副本', () => {
  it('带着它是从哪个版本拷来的', () => {
    expect(AGENT_ROUTES_VERSION).toBeGreaterThan(0);
    expect(AGENT_ROUTES.length).toBeGreaterThan(0);
  });

  it('每条路由的路径模板里没有裸的 project 前缀——那是 base_path 的职责', () => {
    for (const route of AGENT_ROUTES) {
      expect(route.path.startsWith('/')).toBe(true);
      expect(route.path).not.toContain('/projects/');
    }
  });
});

/**
 * 例外名单：这两条是**故意**手写的，其余一律不许。
 *
 * 改成白名单制是因为旧写法漏了（审查 W·S14）：那条正则只认 `/projects/…` 开头的模板，
 * 而 `fetchSessionCredits` 手写的是 `/api/agent/billing/sessions/…`，就从旁边溜过去了。
 * 守卫要能拦住"下一条"，就不能只认已知的那一种形状。
 */
const ALLOWED_HAND_WRITTEN = [
  // 命名空间前缀，不含具体路由——具体路由由 agentPath() 从清单构造后拼进来。
  '/api/agent/v1${path}',
  // BFF 自己的端点。agent 服务手里没有用户凭证，查账这件事只能在 BFF 做，因此它不在
  // agent 路由清单里，也不该在。**新增 BFF 端点必须在这里留名**，否则这条测试会红。
  '/api/agent/billing/',
];

describe('源码守卫：不许再手写 agent 接口地址', () => {
  it('agentSessions.ts 里除白名单外没有手写的接口地址', async () => {
    const source = await import('./agentSessions.ts?raw').then((m) => m.default as string);
    // 先剥掉注释：文档里写 `/api/agent/billing/*` 是在说明，不是在拼地址。
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    // 任何以 /api/agent 或 /projects 开头的路径模板都要过这道关，不再只认 /projects/。
    const literals = [...code.matchAll(/`(\/(?:api\/agent|projects)\/[^`\n]*)`/g)].map((m) => m[1]!);
    const handWritten = literals.filter(
      (path) => !ALLOWED_HAND_WRITTEN.some((allowed) => path.startsWith(allowed)),
    );
    expect(handWritten).toEqual([]);
  });

  it('放宽后的正则确实认得出漏网的那一种——否则这道关等于没有', () => {
    // 用旧写法漏掉的那条真实路径做样本：白名单一旦删掉，它必须被拦下。
    const sample = 'return apiRequest(`/api/agent/billing/sessions/${id}?project_id=${p}`);';
    const literals = [...sample.matchAll(/`(\/(?:api\/agent|projects)\/[^`\n]*)`/g)].map((m) => m[1]!);
    expect(literals).toHaveLength(1);
    expect(literals.filter((path) => !['/api/agent/v1${path}'].some((a) => path.startsWith(a)))).toHaveLength(1);
  });
});
