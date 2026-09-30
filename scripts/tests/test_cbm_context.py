"""Black-box tests of repository-scoped CBM context hooks."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / '.claude/hooks/cbm-discovery-gate.sh'


class CbmContextTests(unittest.TestCase):
    def invoke(self, event='SessionStart', cwd=ROOT, **fields):
        payload = dict(hook_event_name=event, cwd=str(cwd), session_id='cbm-test', **fields)
        result = subprocess.run(['bash', str(HOOK)], input=json.dumps(payload),
                                text=True, capture_output=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return result.stdout

    def context(self, **fields):
        output = self.invoke(**fields)
        self.assertTrue(output, 'repository CBM reminder was not delivered')
        return json.loads(output)['hookSpecificOutput']

    def test_session_context_names_current_worktree_and_protocol(self):
        result = self.context()
        self.assertEqual(result['hookEventName'], 'SessionStart')
        self.assertIn(str(ROOT), result['additionalContext'])
        self.assertIn(str(ROOT / 'agent-rules/code-discovery.md'), result['additionalContext'])

    def test_global_plugin_does_not_suppress_repository_protocol(self):
        # The real home has the official plugin installed: local rules must still arrive.
        result = self.context()
        self.assertIn('CBM', result['additionalContext'])

    def test_git_common_directory_accepts_other_worktree(self):
        main = subprocess.check_output(['git', 'rev-parse', '--path-format=absolute',
                                        '--git-common-dir'], cwd=ROOT, text=True).strip()
        result = self.context(cwd=Path(main).parent)
        self.assertIn(str(Path(main).parent), result['additionalContext'])

    def test_unrelated_repository_with_same_marker_stays_silent(self):
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run(['git', 'init', '-q', folder], check=True)
            p = Path(folder) / 'agent-rules'
            p.mkdir()
            (p / 'code-discovery.md').write_text('copied marker')
            self.assertEqual(self.invoke(cwd=folder), '')

    def test_non_repository_stays_silent(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(self.invoke(cwd=folder), '')

    def test_search_reminder_is_nonblocking_json(self):
        for tool, args in [('Bash', {'command': 'rg BottomDialog web/src'}),
                           ('exec_command', {'cmd': 'grep -n handler app.ts'}),
                           ('Grep', {'pattern': 'BottomDialog'}),
                           ('Glob', {'pattern': '**/*.tsx'})]:
            with self.subTest(tool=tool):
                result = self.context(event='PreToolUse', tool_name=tool, tool_input=args)
                self.assertEqual(result['hookEventName'], 'PreToolUse')
                self.assertIn('CBM', result['additionalContext'])
                self.assertNotIn('permissionDecision', result)

    def test_normal_read_edit_and_shell_are_silent(self):
        for tool, args in [('Read', {}), ('Edit', {}), ('Bash', {'command': 'git status'}),
                           ('Bash', {'command': 'echo progress'})]:
            self.assertEqual(self.invoke('PreToolUse', tool_name=tool, tool_input=args), '')

    def test_kimi_prompt_returns_plain_context(self):
        text = self.invoke('UserPromptSubmit', client_type='kimi_code_cli')
        self.assertIn('agent-rules/code-discovery.md', text)
        self.assertFalse(text.startswith('{'))

    def test_kimi_observation_events_are_silent(self):
        self.assertEqual(self.invoke('SessionStart', client_type='kimi_code_cli'), '')

    def test_subagent_reminder_routes_to_protocol(self):
        result = self.context(event='SubagentStart')
        self.assertIn(str(ROOT / 'agent-rules/code-discovery.md'), result['additionalContext'])

    def test_five_platforms_install_repository_reminders(self):
        for filename, nested in [('.claude/settings.json', False),
                                 ('.codex/hooks.json', False),
                                 ('.zcode/config.json', True),
                                 ('.qoder/settings.json', False)]:
            with self.subTest(platform=filename):
                path = ROOT / filename
                self.assertTrue(path.exists(), filename)
                hooks = json.loads(path.read_text())['hooks']
                if nested:
                    hooks = hooks['events']
                for event in ('SessionStart', 'SubagentStart', 'PreToolUse'):
                    matches = [h for group in hooks.get(event, [])
                               for h in group['hooks'] if 'cbm-' in h.get('command', '')]
                    self.assertEqual(len(matches), 1, (filename, event))
        import tomllib
        hooks = tomllib.loads((ROOT / '.kimi-code/hooks.toml').read_text())['hooks']
        reminders = [h for h in hooks if 'cbm-' in h['command']]
        self.assertEqual([h['event'] for h in reminders], ['UserPromptSubmit'])

    def test_invalid_input_fails_open(self):
        for payload in ['bad-json', '[]', '{"cwd": null}', '{"tool_input": []}']:
            result = subprocess.run(['bash', str(HOOK)], input=payload, text=True,
                                    capture_output=True, cwd=ROOT)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))


if __name__ == '__main__':
    unittest.main()
