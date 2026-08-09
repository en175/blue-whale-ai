import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "check-target-environment-retirement.sh"

CHECK_NAMES = (
    "旧产品进程",
    "旧docker镜像",
    "旧docker容器",
    "旧端口监听",
    "旧环境变量",
    "旧可执行引用",
)

STUB_EMPTY = "#!/usr/bin/env bash\nexit 0\n"
STUB_DOCKER_DAEMON_DOWN = "#!/usr/bin/env bash\nexit 1\n"

STUB_PS_OLD_JAVA = r"""#!/usr/bin/env bash
printf '%s\n' \
  '  4242 java /opt/blue_whale_server/blue-whale-gateway/target/blue-whale-gateway.jar --spring.profiles.active=local' \
  '  5001 node /Users/dev/Blue-Whale-AI/apps/agent-worker/dist/main.js'
exit 0
"""

STUB_PS_SELF_AND_GREP = r"""#!/usr/bin/env bash
printf '%s\n' \
  '  9001 bash /Users/dev/repo/scripts/check-target-environment-retirement.sh' \
  '  9002 grep blue_whale_server' \
  '  9003 python3 -m unittest scripts.tests.test_check_target_environment_retirement'
exit 0
"""

STUB_DOCKER_OLD_IMAGE = r"""#!/usr/bin/env bash
case " $* " in
  *" images "*)
    printf '%s\n' 'blue-whale-gateway:local' 'blue-whale-typescript-baseline:acceptance' 'mysql:8.4'
    ;;
esac
exit 0
"""

STUB_DOCKER_OLD_CONTAINER = r"""#!/usr/bin/env bash
case " $* " in
  *" images "*)
    printf '%s\n' 'mysql:8.4' 'redis:7-alpine'
    ;;
  *" ps "*)
    printf '%s\n' 'bw-agent-worker blue-whale-agent-worker:local'
    ;;
esac
exit 0
"""

STUB_DOCKER_BASELINE_ONLY = r"""#!/usr/bin/env bash
case " $* " in
  *" images "*)
    printf '%s\n' 'blue-whale-typescript-baseline:acceptance' 'mysql:8.4' 'redis:7-alpine'
    ;;
esac
exit 0
"""

STUB_LSOF_OLD_PORT = r"""#!/usr/bin/env bash
printf '%s\n' \
  'COMMAND  PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME' \
  'node    3101 dev   30u  IPv4 0xaaaabbbb      0t0  TCP 127.0.0.1:3000 (LISTEN)' \
  'java    8888 dev   20u  IPv6 0xccccdddd      0t0  TCP *:8686 (LISTEN)'
exit 0
"""


class TestCheckTargetEnvironmentRetirement(unittest.TestCase):
    def _write_stub(self, directory, name, body):
        stub = pathlib.Path(directory) / name
        stub.write_text(body, encoding="utf-8")
        stub.chmod(0o755)

    def _prepare_stubs(self, temp_dir, ps=STUB_EMPTY, docker=STUB_EMPTY, lsof=STUB_EMPTY):
        if ps is not None:
            self._write_stub(temp_dir, "ps", ps)
        if docker is not None:
            self._write_stub(temp_dir, "docker", docker)
        if lsof is not None:
            self._write_stub(temp_dir, "lsof", lsof)

    def _run_gate(self, stub_dir, extra_env=None, extra_path_dir=None):
        path = f"{stub_dir}:/usr/bin:/bin"
        if extra_path_dir is not None:
            path = f"{extra_path_dir}:{path}"
        env_file = pathlib.Path(stub_dir) / "target.env"
        if not env_file.exists():
            env_file.write_text("", encoding="utf-8")
        env = {
            "PATH": path,
            "BW_RETIREMENT_ENV_FILE": str(env_file),
        }
        if extra_env:
            env.update(extra_env)
        return subprocess.run(
            ["bash", str(SCRIPT)],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def assert_no_fail_items(self, output):
        # 逐项判定行以 "FAIL " 开头；总结行的计数器（FAIL 0）不算判定行
        fail_lines = [line for line in output.splitlines() if line.startswith("FAIL ")]
        self.assertEqual(fail_lines, [])

    def test_clean_environment_passes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir)
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 0, result.stderr)
            for name in CHECK_NAMES:
                self.assertIn(f"PASS {name}: 无残留", result.stdout)
            self.assert_no_fail_items(result.stdout)
            self.assertIn("目标环境退役门禁: PASS", result.stdout)

    def test_old_java_process_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir, ps=STUB_PS_OLD_JAVA)
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAIL 旧产品进程: 发现 1 项", result.stdout)
            self.assertIn("4242", result.stdout)
            self.assertIn("blue_whale_server", result.stdout)
            # 其余项不受影响
            self.assertIn("PASS 旧docker镜像: 无残留", result.stdout)
            self.assertIn("PASS 旧端口监听: 无残留", result.stdout)

    def test_old_docker_image_fails_and_keeps_baseline(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir, docker=STUB_DOCKER_OLD_IMAGE)
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAIL 旧docker镜像: 发现 1 项", result.stdout)
            self.assertIn("blue-whale-gateway:local", result.stdout)
            # 现行基线镜像不得被判为旧镜像
            self.assertNotIn("blue-whale-typescript-baseline", result.stdout)
            self.assertIn("PASS 旧docker容器: 无残留", result.stdout)

    def test_old_docker_container_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir, docker=STUB_DOCKER_OLD_CONTAINER)
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAIL 旧docker容器: 发现 1 项", result.stdout)
            self.assertIn("bw-agent-worker", result.stdout)
            self.assertIn("PASS 旧docker镜像: 无残留", result.stdout)

    def test_old_port_listen_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir, lsof=STUB_LSOF_OLD_PORT)
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAIL 旧端口监听: 发现 1 项", result.stdout)
            self.assertIn("8686", result.stdout)
            # 现行端口 3000 不得计入
            self.assertNotIn("3000", result.stdout.split("FAIL 旧端口监听")[1].splitlines()[0])

    def test_old_env_var_fails_without_leaking_value(self):
        secret = "http://secret-gateway.internal:8686/?token=topsecret"
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir)
            result = self._run_gate(temp_dir, extra_env={"GATEWAY_URL": secret})
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAIL 旧环境变量: 发现 1 项", result.stdout)
            self.assertIn("GATEWAY_URL", result.stdout)
            self.assertNotIn(secret, result.stdout)
            self.assertNotIn(secret, result.stderr)
            self.assertNotIn("topsecret", result.stdout)

    def test_old_env_file_key_fails_without_leaking_value(self):
        secret = "http://secret-gateway.internal:8686/?token=topsecret"
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir)
            pathlib.Path(temp_dir, "target.env").write_text(
                f"GATEWAY_URL={secret}\n", encoding="utf-8"
            )
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAIL 旧环境变量: 发现 1 项", result.stdout)
            self.assertIn("GATEWAY_URL", result.stdout)
            self.assertNotIn(secret, result.stdout)
            self.assertNotIn("topsecret", result.stdout)

    def test_retired_path_symlink_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir)
            bin_dir = pathlib.Path(temp_dir) / "bin"
            bin_dir.mkdir()
            os.symlink("/opt/blue_whale_server/bin/java", bin_dir / "java")
            result = self._run_gate(temp_dir, extra_path_dir=str(bin_dir))
            self.assertEqual(result.returncode, 1)
            self.assertIn("FAIL 旧可执行引用: 发现 1 项", result.stdout)
            self.assertIn("blue_whale_server", result.stdout)

    def test_docker_daemon_down_is_inconclusive(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir, docker=STUB_DOCKER_DAEMON_DOWN)
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("SKIP 旧docker镜像", result.stdout)
            self.assertIn("SKIP 旧docker容器", result.stdout)
            self.assert_no_fail_items(result.stdout)
            self.assertIn("PASS 旧产品进程: 无残留", result.stdout)
            self.assertIn("PASS 旧端口监听: 无残留", result.stdout)
            self.assertIn("目标环境退役门禁: INCONCLUSIVE", result.stdout)

    def test_docker_command_missing_is_inconclusive(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir, docker=None)
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("SKIP 旧docker镜像", result.stdout)
            self.assertIn("SKIP 旧docker容器", result.stdout)
            self.assert_no_fail_items(result.stdout)
            self.assertIn("目标环境退役门禁: INCONCLUSIVE", result.stdout)

    def test_lsof_command_missing_is_inconclusive(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(temp_dir, lsof=None)
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("SKIP 旧端口监听", result.stdout)
            self.assertIn("目标环境退役门禁: INCONCLUSIVE", result.stdout)

    def test_no_false_positive_from_self_grep_or_baseline(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self._prepare_stubs(
                temp_dir,
                ps=STUB_PS_SELF_AND_GREP,
                docker=STUB_DOCKER_BASELINE_ONLY,
            )
            result = self._run_gate(temp_dir)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assert_no_fail_items(result.stdout)
            self.assertIn("PASS 旧产品进程: 无残留", result.stdout)
            self.assertIn("PASS 旧docker镜像: 无残留", result.stdout)


if __name__ == "__main__":
    unittest.main()
