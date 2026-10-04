"""Black-box channel decisions, adapters, repository isolation and audit privacy."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / '.claude/hooks/block-gitee-alternative-channel.sh'


class ChannelGateTests(unittest.TestCase):
    def invoke(self, tool, payload, adapter='direct', cwd=ROOT):
        event = {'tool_name': tool, 'tool_input': payload, 'cwd': str(cwd), 'session_id': 'channel-test', 'tool_use_id': 'channel-test-id'}
        command = ['bash', str(GATE)] if adapter == 'direct' else ['bash', str(ROOT / '.codex/hooks/run-claude-pretool.sh'), GATE.name]
        return subprocess.run(command, input=json.dumps(event), text=True, capture_output=True, cwd=cwd)

    def test_alternative_channels_are_rejected(self):
        cases = [
            ('mcp__cua_repl__js', {'code': 'await cua.getTab({url:"https://e.gitee.com/x/pulls/1"})'}),
            ('mcp__cua_repl__js', {'code': 'await tab.click({selector:"提交"})'}),
            ('mcp__browser__navigate', {'url': 'https://gitee.com/login?redirect_to_url=https%3A%2F%2Fe.gitee.com'}),
            ('mcp__cua_repl__js', {'code': 'await tab.goto("https://gitee.com")'}),
            ('mcp__browser__navigate', {'url': 'https://gitee.com?redirect=login'}),
            ('Bash', {'command': 'curl https://api.gitee.com?access_token=fixture'}),
            ('Bash', {'command': 'curl https://api.gitee.com/enterprises/1/issues'}),
            ('exec_command', {'cmd': 'wget https://e.gitee.com/x/pulls/1'}),
            ('Bash', {'command': 'python3 -c "import requests;requests.get(\'https://api.gitee.com/enterprises/1\')"'}),
            ('Bash', {'command': 'python3.12 -c "import requests;requests.get(\'https://api.gitee.com/enterprises/1\')"'}),
            ('Bash', {'command': 'tabbit-cli exec "page.click(\'提交\')"'}),
            ('exec', {'code': 'await tools.mcp__cua_repl__js({code:"tab.click()"})'}),
            ('mcp__codex_app__open_in_codex', {'target': {'type': 'browser', 'url': 'https://gitee.com/x/pulls/1'}}),
            ('WebFetch', {'url': 'https://gitee.com/x/issues'}),
            ('Bash', {'command': 'open https://e.gitee.com/x/pulls/1'}),
        ]
        for adapter in ['direct', 'codex']:
            for tool, payload in cases:
                with self.subTest(tool=tool, adapter=adapter):
                    result = self.invoke(tool, payload, adapter)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertEqual(result.stdout, '')
                    self.assertIn('BLOCKED', result.stderr)

    def test_mcp_git_and_product_work_remain_available(self):
        cases = [
            ('mcp__gitee-ent__create_enterprise_issue', {'description': 'https://gitee.com/x/pulls/1'}),
            ('mcp__gitee_ent__get_enterprise_pull_detail', {'pull_request_id': 1}),
            ('Bash', {'command': 'git push git@gitee.com:hangzhou-xuanfu_1/blue-whale-ai.git HEAD'}),
            ('Bash', {'command': 'pnpm exec playwright test web/e2e/canvas.test.ts'}),
            ('Bash', {'command': 'bash scripts/test-hooks.sh'}),
            ('Bash', {'command': 'rg "curl https://gitee.com" docs/agents/issue-tracker.md'}),
            ('mcp__browser__navigate', {'url': 'http://127.0.0.1:3000/canvas'}),
            ('mcp__browser__navigate', {'url': 'https://gitee.com.example.org/product'}),
            ('mcp__cua_repl__js', {'code': 'await cua.createBrowserTab("iab", "http://localhost:3000/canvas")'}),
            ('Read', {'file_path': 'docs/agents/issue-tracker.md'}),
        ]
        for tool, payload in cases:
            with self.subTest(tool=tool):
                result = self.invoke(tool, payload)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, '')

    def test_direct_python_script_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            path = Path(directory) / 'alternative.py'
            path.write_text('import requests\nrequests.get("https://api.gitee.com/enterprises/1")\n')
            result = self.invoke('Bash', {'command': f'python3 {path}'})
            self.assertEqual(result.returncode, 2, result.stderr)

    def test_unrelated_repository_is_unaffected(self):
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(['git', 'init', '-q', directory], check=True)
            result = self.invoke('mcp__cua_repl__js', {'code': 'tab.click()'}, cwd=Path(directory))
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_qoder_and_four_platform_contracts(self):
        for filename, keys in [('.claude/settings.json', ['hooks']), ('.codex/hooks.json', ['hooks']), ('.zcode/config.json', ['hooks', 'events']), ('.qoder/settings.json', ['hooks'])]:
            data = json.loads((ROOT / filename).read_text())
            for key in keys:
                data = data[key]
            entries = [e for e in data['PreToolUse'] if e.get('matcher') == '.*']
            self.assertEqual(len(entries), 1, filename)
            self.assertIn(GATE.name, entries[0]['hooks'][0]['command'])

    def test_configured_commands_reach_gate_instead_of_shell_parse_errors(self):
        env = dict(os.environ, CLAUDE_PROJECT_DIR=str(ROOT))
        for filename, keys in [('.claude/settings.json', ['hooks']), ('.codex/hooks.json', ['hooks']), ('.zcode/config.json', ['hooks', 'events']), ('.qoder/settings.json', ['hooks'])]:
            data = json.loads((ROOT / filename).read_text())
            for key in keys:
                data = data[key]
            command = next(h['command'] for e in data['PreToolUse'] for h in e.get('hooks', []) if GATE.name in h['command'])
            for tool, payload, expected in [('mcp__cua_repl__js', {'code': 'tab.click()'}, 2), ('mcp__gitee_ent__get_enterprise_issue_detail', {}, 0)]:
                with self.subTest(config=filename, tool=tool):
                    event = {'cwd': str(ROOT), 'tool_name': tool, 'tool_input': payload}
                    result = subprocess.run(['bash', '-c', command], cwd=ROOT, env=env, input=json.dumps(event), text=True, capture_output=True)
                    self.assertEqual(result.returncode, expected, result.stderr)
                    if expected == 2:
                        self.assertIn('仅走 Gitee MCP', result.stderr)

    def test_audit_does_not_record_request_values(self):
        secret = 'test-sensitive-value-must-not-appear'
        self.invoke('Bash', {'command': f'curl https://api.gitee.com/enterprises/1?access_token={secret}'})
        result = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd=ROOT, text=True, capture_output=True, check=True)
        audit = Path(result.stdout.strip()) / 'hook-audit' / (GATE.name + '.log')
        text = audit.read_text()
        self.assertNotIn(secret, text)
        self.assertNotIn('access_token=', text)
        self.assertIn('blocked-gitee-http', text)

    def test_malformed_event_fails_closed(self):
        result = subprocess.run(['bash', str(GATE)], input='not-json', text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)


if __name__ == '__main__':
    unittest.main()
