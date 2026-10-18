import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';

import { ensureTunnel, parseForward, MqCheckError } from './mq-tunnel.mjs';

let stage = '参数';
let producer;
let deadline;
let pendingTunnel;
const abort = new AbortController();
const log = (message) => console.log(`[MQ ${stage}] ${message}`);
const fail = (message) => { throw new MqCheckError(message); };
const options = { timeout: 20000, forwards: new Map() };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const name = args[i];
  const value = args[i + 1];
  if (!value || !['--backend-pid', '--timeout-ms', '--mq-ssh', '--mq-forward'].includes(name)) {
    console.error('[MQ 参数] 用法：check-mq.mjs --backend-pid PID [--timeout-ms 20000]');
    process.exit(2);
  }
  if (name === '--backend-pid') options.pid = value;
  else if (name === '--timeout-ms') options.timeout = Number(value);
  else if (name === '--mq-ssh') options.target = value;
  else {
    try {
      const forward = parseForward(value);
      if (options.forwards.has(forward.local)) throw new MqCheckError('同一本地端口只能声明一次映射。');
      options.forwards.set(forward.local, forward);
    } catch (error) { console.error(`[MQ 参数] ${error.message}`); process.exit(2); }
  }
}

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8', timeout: 3000 });
  if (result.status !== 0) fail('无法读取后端进程；重新运行体检确认 3100 的 PID 和权限。');
  return result.stdout.trim();
}

function processConfig(pid) {
  if (command('lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN', '-t']) !== pid) {
    fail('3100 的监听进程已变化或不唯一；重新运行体检。');
  }
  const cwd = command('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'])
    .split('\n').find(line => line.startsWith('n'))?.slice(1);
  if (!cwd) fail('无法取得后端工作目录；核对 3100 监听进程。');
  const launch = command('ps', ['-p', pid, '-o', 'command=']);
  if (/--env-file|--import|--require|(?:^|\s)-r\s/.test(launch)) {
    fail('后端使用了额外环境加载器，无法证明有效配置；按启动技能通过进程环境注入配置后重启受控后端。');
  }
  const main = launch.match(/(?:^|\s)(\S*dist\/apps\/blue-whale\/src\/main\.js)(?:\s|$)/)?.[1];
  if (!main) fail('3100 不是受支持的已构建后端；按启动技能运行 dist/apps/blue-whale/src/main.js。');
  const backend = resolve(cwd, main).replace(/\/dist\/apps\/blue-whale\/src\/main\.js$/, '');
  let entries;
  if (process.platform === 'linux') {
    entries = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
  } else {
    const full = command('ps', ['eww', '-p', pid, '-o', 'command=']);
    if (!full.startsWith(launch)) fail('进程在检查期间变化；重新运行体检。');
    entries = full.slice(launch.length).trim().split(/\s+(?=[A-Za-z_][A-Za-z0-9_]*=)/);
  }
  const env = Object.fromEntries(entries.filter(entry => entry.includes('='))
    .map(entry => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));
  if (/--env-file|--import|--require|(?:^|\s)-r\s/.test(env.NODE_OPTIONS ?? '')) {
    fail('NODE_OPTIONS 包含额外环境加载器；按启动技能通过进程环境注入配置。');
  }
  return { backend, env, launch };
}

const ensured = new Set();
async function tcp(address) {
  const local = `${address.host === 'localhost' ? '127.0.0.1' : address.host}:${address.port}`;
  if (options.target && !ensured.has(local)) {
    const forward = options.forwards.get(local);
    if (!forward) fail(`地址 ${local} 缺少显式 --mq-forward 映射；核对路由后补齐再执行。`);
    pendingTunnel = ensureTunnel(options.target, forward, log, abort.signal);
    await pendingTunnel;
    pendingTunnel = undefined;
    ensured.add(local);
  }
  await new Promise((accept, reject) => {
    const socket = createConnection({ host: address.host, port: address.port });
    const finish = (error) => { socket.destroy(); error ? reject(error) : accept(); };
    socket.once('connect', () => finish());
    socket.once('error', () => finish(new MqCheckError('连接失败；启动对应 MQ，或使用 --mq-ssh 与 --mq-forward 建立所需转发。')));
    socket.setTimeout(2000, () => finish(new MqCheckError('连接超时；检查对应 MQ 或 SSH 转发。')));
  });
}

async function main() {
  if (!/^\d+$/.test(options.pid ?? '') || !Number.isInteger(options.timeout) || options.timeout < 1000 || options.timeout > 60000) {
    fail('PID 必须为数字，超时必须为 1000–60000 毫秒。');
  }
  if (options.target && !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(options.target)) fail('--mq-ssh 必须是 SSH 别名或 user@host。');
  if (Boolean(options.target) !== Boolean(options.forwards.size)) fail('--mq-ssh 与 --mq-forward 必须同时提供。');
  stage = '配置';
  const before = processConfig(options.pid);
  const require = createRequire(resolve(before.backend, 'package.json'));
  const { Producer, StatusChecker, TopicRouteData } = require('rocketmq-client-nodejs');
  const { QueryRouteRequest, HeartbeatRequest } = require('rocketmq-client-nodejs/proto/apache/rocketmq/v2/service_pb.js');
  const { Resource, ClientType, Permission } = require('rocketmq-client-nodejs/proto/apache/rocketmq/v2/definition_pb.js');
  const { loadRocketMqConfig } = await import(pathToFileURL(resolve(before.backend, 'dist/libs/infra/mq/rocketmq-producer.js')));
  const { GENERATION_TASK_QUEUE: topic } = await import(pathToFileURL(resolve(before.backend, 'dist/libs/shared/generation/queue.constants.js')));
  const config = loadRocketMqConfig(before.env);
  if (!config.endpoints) fail('实际后端未配置 ROCKETMQ_ENDPOINTS；配置可达的 MQ 后重启受控后端。');
  if (!/^[a-zA-Z0-9.:-]+(?:;[a-zA-Z0-9.:-]+)*$/.test(config.endpoints)) fail('端点格式无效；使用 RocketMQ host:port 端点。');
  log(`pid=${options.pid} 代码目录=${before.backend} 端点=${config.endpoints} TLS=${config.sslEnabled} topic=${topic}`);
  producer = new Producer({
    endpoints: config.endpoints, sslEnabled: config.sslEnabled, namespace: '', topics: [topic], requestTimeout: 3000,
    ...(config.accessKey && config.accessSecret ? { sessionCredentials: { accessKey: config.accessKey, accessSecret: config.accessSecret } } : {}),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  stage = '初始端点';
  for (const address of producer.getEndpoints().addressesList) {
    log(`检查 ${address.host}:${address.port}`);
    await tcp(address);
  }
  log('PASS');
  stage = 'topic 路由';
  const request = new QueryRouteRequest().setTopic(new Resource().setName(topic)).setEndpoints(producer.getEndpoints().toProtobuf());
  let response;
  try {
    response = await producer.getRpcClientManager().queryRoute(producer.getEndpoints(), request, 3000);
    StatusChecker.check(response.getStatus()?.toObject());
  } catch {
    fail('路由查询失败；核对真实 topic、TLS、MQ 凭据和初始端点目标。');
  }
  const route = new TopicRouteData(response.getMessageQueuesList());
  if (route.isEmpty() || !route.messageQueues.some(queue => [Permission.WRITE, Permission.READ_WRITE].includes(queue.permission))) fail('真实 topic 没有队列；请环境负责人核对 topic。');
  log(`PASS topic=${topic} 队列数=${route.getQueueCount()}`);
  stage = '返回地址';
  for (const endpoints of route.getTotalEndpoints()) {
    for (const address of endpoints.addressesList) {
      log(`检查 ${address.host}:${address.port}`);
      await tcp(address);
    }
  }
  log('PASS');
  stage = '协议握手';
  try { await producer.startup(); } catch { fail('真实 topic 的生产者启动失败；检查返回地址的协议、TLS 和权限。'); }
  for (const endpoints of route.getTotalEndpoints()) {
    try {
      const heartbeat = await producer.getRpcClientManager().heartbeat(endpoints, new HeartbeatRequest().setClientType(ClientType.PRODUCER), 3000);
      StatusChecker.check(heartbeat.getStatus()?.toObject());
    } catch { fail('返回地址协议通信失败；核对返回地址、TLS 和 MQ 权限。'); }
  }
  log('PASS');
  stage = '关闭';
  await producer.shutdown();
  log('PASS');
  stage = '配置复核';
  const after = processConfig(options.pid);
  if (before.backend !== after.backend || before.launch !== after.launch ||
      JSON.stringify(config) !== JSON.stringify(loadRocketMqConfig(after.env))) fail('检查期间后端配置变化；重新运行体检。');
  log('PASS MQ 连接可用；未发送业务消息。任务入队、消费及产物仍需受控任务验收。');
}

function reportFailure(error) {
  const message = error instanceof MqCheckError ? error.message
    : ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)
      ? '缺少实际后端构建或依赖；完整构建该后端后重试。'
      : '检查失败；核对本阶段的配置、MQ 服务与客户端版本后重新执行。';
  log(`FAIL ${message}`);
}

process.once('uncaughtException', error => {
  reportFailure(error);
  producer?.getRpcClientManager().close();
  process.exit(1);
});

try {
  await Promise.race([
    main(),
    new Promise((_, reject) => {
      deadline = setTimeout(() => {
        abort.abort();
        reject(new MqCheckError('超时；核对本阶段端点、MQ 权限和 SSH 转发后重新运行体检。'));
      }, options.timeout);
    }),
  ]);
  clearTimeout(deadline);
  process.exit(0);
} catch (error) {
  await pendingTunnel?.catch(() => {});
  reportFailure(error);
  producer?.getRpcClientManager().close();
  clearTimeout(deadline);
  process.exit(1);
}
