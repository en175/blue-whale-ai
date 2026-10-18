import os
import json
import shutil
import socket
import signal
import sys
import time
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / '.agents/skills/start-local-services/scripts/check-local-services.sh'


class LocalServicesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.bin = self.directory / 'bin'
        self.bin.mkdir()
        self.env = {**os.environ, 'PATH': f'{self.bin}:{os.environ["PATH"]}'}
        self.command('lsof', 'exit 1')
        self.command('redis-cli', 'exit 1')

    def command(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/sh\n' + body + '\n')
        path.chmod(0o755)

    def run_check(self, *args):
        return subprocess.run(['bash', str(SCRIPT), *args], env=self.env,
                              capture_output=True, text=True, timeout=15)

    def ready_http(self):
        self.command('lsof', 'echo 12345')
        self.command('curl', 'printf 200')
        self.command('redis-cli', 'echo PONG')
        self.command('ps', 'echo "node dist/apps/blue-whale/src/main.js ROCKETMQ_ENDPOINTS=127.0.0.1:1"')

    def test_media_readiness_is_not_http_readiness(self):
        self.ready_http()
        self.env['ROCKETMQ_ENDPOINTS'] = '127.0.0.1:8081'
        result = self.run_check('--media')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('[MQ', result.stdout + result.stderr)

    def test_page_check_does_not_require_mq(self):
        self.ready_http()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def mq_backend(self, mode='ok', returned_port=None, endpoint_port=None):
        backend = self.directory / 'backend'
        backend.mkdir()
        (backend / 'package.json').write_text('{"type":"module"}')
        (backend / 'node_modules').symlink_to(ROOT / 'backend/node_modules', target_is_directory=True)
        for name in ['libs/infra/mq/rocketmq-producer', 'libs/shared/generation/queue.constants']:
            dest = backend / 'dist' / (name + '.js')
            dest.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['node', '--input-type=module', '-e',
                            "import {stripTypeScriptTypes} from 'node:module'; import fs from 'node:fs'; "
                            "fs.writeFileSync(process.argv[2],stripTypeScriptTypes(fs.readFileSync(process.argv[1],'utf8')))",
                            str(ROOT / 'backend' / (name + '.ts')), str(dest)], check=True, capture_output=True)
        main = backend / 'dist/apps/blue-whale/src/main.js'
        main.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / 'scripts/tests/fixtures/local-mq-server.mjs', main)
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0))
            port = reserve.getsockname()[1]
        self.events = self.directory / 'events'
        spec = json.dumps(dict(mode=mode, port=port, routePort=returned_port or port, log=str(self.events)))
        child = subprocess.Popen(['node', str(main), spec], cwd=backend,
                                 env={**os.environ, 'ROCKETMQ_ENDPOINTS': f'127.0.0.1:{endpoint_port or port}',
                                      'ROCKETMQ_ACCESS_KEY': 'secret-access-sentinel',
                                      'ROCKETMQ_SECRET_KEY': 'secret-key-sentinel'},
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        def stop():
            child.terminate()
            child.communicate(timeout=5)
        self.addCleanup(stop)
        self.assertEqual(child.stdout.readline().strip(), 'READY')
        lsof = shutil.which('lsof')
        self.command('lsof', f'case "$*" in *-iTCP:3000*|*-iTCP:3100*) echo {child.pid};; *) exec "{lsof}" "$@";; esac')
        self.command('curl', 'printf 200')
        self.command('redis-cli', 'echo PONG')
        self.env['ROCKETMQ_ENDPOINTS'] = '127.0.0.1:1'
        return port

    def test_real_topic_protocol_passes_without_sending(self):
        self.mq_backend()
        result = self.run_check('--media', '--timeout-ms', '8000')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('MQ 连接可用', result.stdout)
        self.assertIn('route:generation-task', self.events.read_text())
        self.assertIn('close', self.events.read_text())
        self.assertNotIn('UNEXPECTED_SEND', self.events.read_text())
        self.assertNotIn('secret-', result.stdout + result.stderr)

    def test_initial_endpoint_failure_returns_nonzero(self):
        self.mq_backend(endpoint_port=1)
        result = self.run_check('--media')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[MQ 初始端点] FAIL', result.stdout)

    def test_route_timeout_is_bounded(self):
        self.mq_backend('route-timeout')
        started = time.monotonic()
        result = self.run_check('--media', '--timeout-ms', '2000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[MQ topic 路由] FAIL 超时', result.stdout)
        self.assertLess(time.monotonic() - started, 6)

    def test_process_configuration_change_invalidates_result(self):
        port = self.mq_backend()
        real_ps = shutil.which('ps')
        counter = self.directory / 'ps-count'
        shim = self.directory / 'ps.py'
        shim.write_text("import pathlib, subprocess, sys\n"
                        f"result = subprocess.run([{real_ps!r}, *sys.argv[1:]], capture_output=True, text=True)\n"
                        "output = result.stdout\n"
                        "if sys.argv[1:3] == ['eww', '-p']:\n"
                        f"    counter = pathlib.Path({str(counter)!r})\n"
                        "    count = int(counter.read_text()) + 1 if counter.exists() else 1\n"
                        "    counter.write_text(str(count))\n"
                        f"    if count > 1: output = output.replace('ROCKETMQ_ENDPOINTS=127.0.0.1:{port}', 'ROCKETMQ_ENDPOINTS=127.0.0.1:1')\n"
                        "print(output, end='')\n")
        self.command('ps', f'exec "{sys.executable}" "{shim}" "$@"')
        if sys.platform != 'darwin':
            self.skipTest('macOS ps 环境读取分支；Linux 使用 /proc 的独立进程环境')
        result = self.run_check('--media')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[MQ 配置复核] FAIL', result.stdout)

    def test_route_failure_returns_nonzero(self):
        self.mq_backend('route-fail')
        result = self.run_check('--media', '--timeout-ms', '6000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[MQ topic 路由] FAIL', result.stdout)

    def test_returned_address_failure_returns_nonzero(self):
        self.mq_backend(returned_port=1)
        result = self.run_check('--media', '--timeout-ms', '6000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[MQ 返回地址] FAIL', result.stdout)

    def test_tcp_and_route_success_without_handshake_is_not_ready(self):
        self.mq_backend('handshake-timeout')
        result = self.run_check('--media', '--timeout-ms', '3000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[MQ 协议握手] FAIL 超时', result.stdout)

    def free_port(self):
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0))
            return reserve.getsockname()[1]

    def remote_mq(self):
        initial, returned = self.free_port(), self.free_port()
        remote = self.mq_backend(returned_port=returned, endpoint_port=initial)
        self.command('ssh', f'exec "{sys.executable}" "{ROOT / "scripts/tests/fixtures/mq-ssh.py"}" "$@"')
        self.env['TMPDIR'] = str(self.directory)
        def close_tunnels():
            for path in self.directory.glob('bw-mq-*/*'):
                if len(path.name) == 20:
                    try:
                        os.kill(json.loads(path.read_text())['pid'], signal.SIGTERM)
                    except (OSError, ValueError):
                        pass
        self.addCleanup(close_tunnels)
        args = ('--media', '--mq-ssh', 'isolated-test',
                '--mq-forward', f'127.0.0.1:{initial}=127.0.0.1:{remote}',
                '--mq-forward', f'127.0.0.1:{returned}=127.0.0.1:{remote}')
        return args, initial

    def test_remote_tunnels_are_reused_and_dead_forward_is_detected(self):
        args, _ = self.remote_mq()
        first = self.run_check(*args)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual(first.stdout.count('转发建立 '), 2)
        second = self.run_check(*args)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertEqual(second.stdout.count('转发复用 '), 2)
        control = next(path for path in self.directory.glob('bw-mq-*/*') if len(path.name) == 20)
        os.kill(json.loads(control.read_text())['pid'], signal.SIGTERM)
        time.sleep(.1)
        dead = self.run_check('--media')
        self.assertNotEqual(dead.returncode, 0, dead.stdout)
        recovered = self.run_check(*args)
        self.assertEqual(recovered.returncode, 0, recovered.stdout + recovered.stderr)
        self.assertIn('转发已失效', recovered.stdout)

    def test_changed_ssh_target_does_not_reuse_previous_connection(self):
        args, _ = self.remote_mq()
        first = self.run_check(*args)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        changed = tuple('changed-target' if arg == 'isolated-test' else arg for arg in args)
        result = self.run_check(*changed)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('端口冲突', result.stdout)

    def test_changed_target_behind_same_alias_is_not_reused(self):
        args, _ = self.remote_mq()
        first = self.run_check(*args)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.env['MQ_TEST_SSH_HOST'] = 'different-host'
        result = self.run_check(*args)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('端口冲突', result.stdout)

    def test_redis_stall_cannot_block_media_check(self):
        self.ready_http()
        self.command('redis-cli', f'exec "{sys.executable}" -c "import time; time.sleep(20)"')
        started = time.monotonic()
        result = self.run_check('--media')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[MQ', result.stdout)
        self.assertLess(time.monotonic() - started, 7)

    def test_ssh_timeout_releases_lock(self):
        args, _ = self.remote_mq()
        self.command('ssh', f'if [ "$1" = "-G" ]; then echo "hostname isolated"; else exec "{sys.executable}" -c "import time; time.sleep(20)"; fi')
        result = self.run_check(*args, '--timeout-ms', '1000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('超时', result.stdout)
        self.assertFalse(list(self.directory.glob('bw-mq-*/*.lock')))

    def test_remote_port_conflict_is_not_adopted(self):
        args, initial = self.remote_mq()
        with socket.socket() as unrelated:
            unrelated.bind(('127.0.0.1', initial))
            unrelated.listen()
            result = self.run_check(*args)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('端口冲突', result.stdout)
            self.assertEqual(unrelated.getsockname()[1], initial)

    def test_unavailable_services_fail_readiness(self):
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('未监听', result.stdout)


if __name__ == '__main__':
    unittest.main()
