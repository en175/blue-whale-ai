import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export class MqCheckError extends Error {}

const execute = promisify(execFile);
async function run(command, args, signal) {
  try { return { ok: true, ...await execute(command, args, { encoding: 'utf8', timeout: 8000, signal }) }; }
  catch (error) {
    if (signal?.aborted) throw new MqCheckError('超时；核对 SSH 目标后重新执行。');
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; }
}

export function parseForward(value) {
  const match = value.match(/^(127\.0\.0\.1):(\d+)=(localhost|[a-zA-Z0-9][a-zA-Z0-9.-]*):(\d+)$/);
  if (!match || [match[2], match[4]].some(port => Number(port) < 1024 || Number(port) > 65535)) {
    throw new MqCheckError('--mq-forward 应为 127.0.0.1:本地端口=远端主机:端口，端口范围 1024–65535。');
  }
  return { local: `${match[1]}:${Number(match[2])}`, remote: `${match[3]}:${Number(match[4])}` };
}

export async function ensureTunnel(target, forward, log, signal) {
  const directory = join(tmpdir(), `bw-mq-${process.getuid()}`);
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new MqCheckError('MQ 控制目录权限不安全；检查当前用户临时目录下的 bw-mq 目录权限。');
  }
  const effective = await run('ssh', ['-G', target], signal);
  if (!effective.ok || !/^hostname /m.test(effective.stdout)) {
    throw new MqCheckError('无法解析 SSH 实际配置；核对 SSH 别名后重新执行。');
  }
  if (/^(?:local|remote|dynamic)forward\s/m.test(effective.stdout)) {
    throw new MqCheckError('SSH 配置含额外转发；请使用不含 LocalForward、RemoteForward 或 DynamicForward 的专用 SSH 别名后重试。');
  }
  const hash = createHash('sha256').update(JSON.stringify({ target, config: effective.stdout, ...forward })).digest('hex').slice(0, 20);
  const control = join(directory, hash);
  const lock = join(directory, `${forward.local.replaceAll(':', '-')}.lock`);
  const record = event => {
    appendFileSync(join(directory, 'lifecycle.log'), JSON.stringify({ time: new Date().toISOString(), event, target, ...forward }) + '\n', { mode: 0o600 });
    log(`转发${event} ${forward.local} → ${target}:${forward.remote}`);
  };
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new MqCheckError(`端口 ${forward.local} 正由另一体检处理；等待其退出后重试，异常退出时核实后清理 ${lock}。`); }
  try {
    const check = await run('ssh', ['-S', control, '-O', 'check', target], signal);
    const pid = check.stderr.match(/Master running \(pid=(\d+)\)/)?.[1];
    const listeners = await run('lsof', ['-nP', `-iTCP:${forward.local.split(':')[1]}`, '-sTCP:LISTEN', '-t'], signal);
    if (check.ok && pid) {
      const owned = await run('lsof', ['-nP', '-a', '-p', pid, `-iTCP@${forward.local}`, '-sTCP:LISTEN', '-t'], signal);
      if (!owned.ok || owned.stdout.trim() !== pid || listeners.stdout.trim() !== pid) {
        record('归属冲突');
        throw new MqCheckError(`端口 ${forward.local} 与受管 SSH 不一致；核对监听归属后重试，不自动停止进程。`);
      }
      record('复用');
      return;
    }
    if (listeners.stdout.trim()) {
      record('端口冲突');
      throw new MqCheckError(`端口 ${forward.local} 已被非当前配置的连接占用；核对归属，使用 --media 检查已有连接，或由负责人释放后重试。`);
    }
    if (existsSync(control) || existsSync(`${control}.started`)) record('已失效');
    if (existsSync(control)) unlinkSync(control);
    const start = await run('ssh', ['-fNT', '-M', '-S', control,
      '-o', 'ControlPersist=no', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=5',
      '-L', `${forward.local}:${forward.remote}`, target], signal);
    if (!start.ok) {
      record('建立失败');
      throw new MqCheckError('SSH 转发失败；核对 SSH 别名、密钥权限、主机信任及远端 MQ，不自动更改远端配置。');
    }
    const created = await run('ssh', ['-S', control, '-O', 'check', target], signal);
    const createdPid = created.stderr.match(/Master running \(pid=(\d+)\)/)?.[1];
    const owned = createdPid && await run('lsof', ['-nP', '-a', '-p', createdPid, `-iTCP@${forward.local}`, '-sTCP:LISTEN', '-t'], signal);
    if (!created.ok || !owned?.ok || owned.stdout.trim() !== createdPid) {
      record('启动后失效');
      throw new MqCheckError('转发启动后不可用；检查监听端口和 SSH 目标后重新执行。');
    }
    writeFileSync(`${control}.started`, createdPid, { mode: 0o600 });
    record('建立');
    log(`停止该转发：ssh -S ${control} -O exit ${target}`);
  } finally {
    rmdirSync(lock);
  }
}
