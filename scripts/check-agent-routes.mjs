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
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../web/src/api/agent-rest-routes.v1.json'), 'utf8'),
);

const routesUrl = new URL(`${base.replace(/\/+$/, '')}/v1/routes`);
const response = await fetch(routesUrl, {
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
