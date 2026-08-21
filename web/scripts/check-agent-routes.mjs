/**
 * 把本地的 agent 路由清单副本与线上活的清单比对（IKACK2）。
 *
 * 为什么需要它：`src/api/agent-rest-routes.v1.json` 是从 agent 仓拷过来的。两个仓库之间
 * 没有共享的包 registry，所以**这份副本是否过期，两边本地都证明不了**——而过期的副本
 * 正是客户端去访问一个不存在的地址的方式。agent 提供 `GET /v1/routes` 返回活的清单，
 * 这个脚本就是拿副本去比它。
 *
 * 需要连得上 agent，所以**不能进纯静态门禁**。该在什么时候跑：
 *   - 升级 agent 服务之后
 *   - 改动 agent 接口的 PR 里
 *   - 排查「请求打到 404」这类问题时的第一步
 *
 * 用法：
 *   node scripts/check-agent-routes.mjs https://agent.example.com <service-token>
 *   AGENT_BASE_URL=... AGENT_SERVICE_TOKEN=... node scripts/check-agent-routes.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const base = process.argv[2] ?? process.env.AGENT_BASE_URL;
const token = process.argv[3] ?? process.env.AGENT_SERVICE_TOKEN;
if (!base) {
  console.error('用法：node scripts/check-agent-routes.mjs <agent-base-url> [service-token]');
  process.exit(2);
}

const local = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/api/agent-rest-routes.v1.json'), 'utf8'),
);

const response = await fetch(new URL('/v1/routes', base), {
  headers: token ? { authorization: `Bearer ${token}` } : {},
});
if (!response.ok) {
  console.error(`读取线上清单失败：${response.status} ${response.statusText}`);
  console.error(response.status === 401 ? '需要服务凭证，见用法。' : `确认 ${base} 是 agent 服务的地址。`);
  process.exit(2);
}
const live = await response.json();

const key = (route) => `${route.method} ${route.path}`;
const localByName = new Map(local.routes.map((route) => [route.name, route]));
const liveByName = new Map(live.routes.map((route) => [route.name, route]));

const problems = [];
for (const [name, route] of liveByName) {
  const mine = localByName.get(name);
  if (!mine) problems.push(`线上有而副本没有：${name}（${key(route)}）——副本过期了`);
  else if (key(mine) !== key(route)) problems.push(`地址不一致：${name}\n    副本 ${key(mine)}\n    线上 ${key(route)}`);
}
for (const [name, route] of localByName) {
  // 这一类最危险：客户端可能正在访问一个线上根本没有的地址，而失败只是一个安静的 404。
  if (!liveByName.has(name)) problems.push(`副本有而线上没有：${name}（${key(route)}）——客户端会打在 404 上`);
}
if (local.version !== live.version) {
  problems.push(`清单版本不同：副本 v${local.version}，线上 v${live.version}`);
}

if (problems.length) {
  console.error(`agent 路由副本与线上不一致（${problems.length} 处）：\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\n修法：把 agent 仓的 contracts/agent-rest-routes.v1.json 重新拷到 web/src/api/。');
  process.exit(1);
}
console.log(`agent 路由副本与线上一致：${live.routes.length} 条，v${live.version}`);
