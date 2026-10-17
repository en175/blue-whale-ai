import json
import subprocess
import unittest
from pathlib import Path

from bash_helper import BASH

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / '.claude/hooks/remind-issue-state.sh'


class RemindIssueStateTest(unittest.TestCase):

    def run_hook(self, payload):
        return subprocess.run([BASH, str(SCRIPT)], input=json.dumps(payload),
                              text=True, capture_output=True, timeout=10)

    def test_worktree_entry_reminder_is_injected_json(self):
        result = self.run_hook({'tool_name': 'Bash', 'tool_input': {
            'command': 'scripts/start-task-worktree.sh --issue IKJIU7 fix/x'},
            'tool_response': {'exit_code': 0}})
        self.assertEqual(result.returncode, 0)
        specific = json.loads(result.stdout)['hookSpecificOutput']
        self.assertEqual(specific['hookEventName'], 'PostToolUse')
        self.assertIn('工单状态提醒', specific['additionalContext'])
        self.assertIn('IKJIU7', specific['additionalContext'])

    def test_pr_and_merge_reminders_inject_json(self):
        for tool in ('mcp__gitee-ent__create_enterprise_repo_pull',
                     'mcp__gitee-ent__merge_enterprise_pull'):
            with self.subTest(tool=tool):
                result = self.run_hook({'tool_name': tool, 'tool_input': {},
                                        'tool_response': {'isError': False}})
                self.assertEqual(result.returncode, 0)
                specific = json.loads(result.stdout)['hookSpecificOutput']
                self.assertEqual(specific['hookEventName'], 'PostToolUse')
                self.assertIn('additionalContext', specific)
                context = specific['additionalContext']
                self.assertIn('保持业务状态', context)
                self.assertIn('gitee-workflow-agent.md', context)
                self.assertNotIn('修复待验证', context)
                if 'create' in tool:
                    self.assertIn('ready-for-review', context)
                    self.assertIn('合并保留', context)
                else:
                    self.assertIn('部署覆盖', context)

    def test_claude_bash_lifecycle_payloads_distinguish_success(self):
        payload = {'hook_event_name': 'PostToolUse', 'tool_name': 'Bash',
                   'tool_input': {'command': 'scripts/start-task-worktree.sh --issue IKJIU7'},
                   'tool_response': {'stdout': 'created', 'stderr': '', 'interrupted': False,
                                     'isImage': False, 'noOutputExpected': False}}
        result = self.run_hook(payload)
        self.assertEqual(result.returncode, 0)
        self.assertIn('工单状态提醒', result.stdout)
        for response in ({'stdout': 'created', 'stderr': '', 'interrupted': True},
                         {'stdout': 'created', 'stderr': ''},
                         {'stdout': 'created', 'stderr': '', 'interrupted': False,
                          'exit_code': 1}):
            with self.subTest(response=response):
                result = self.run_hook({**payload, 'tool_response': response})
                self.assertEqual(result.stdout, '')
        result = self.run_hook({**payload, 'hook_event_name': 'PostToolUseFailure',
                                'error': 'Exit code 1', 'is_interrupt': False})
        self.assertEqual(result.stdout, '')

    def test_kimi_client_receives_plain_text(self):
        result = self.run_hook({
            'tool_name': 'Bash', 'client_type': 'kimi_code_cli',
            'hook_event_name': 'PostToolUse',
            'tool_input': {'command': 'scripts/start-task-worktree.sh --issue IKJIU7'},
            'tool_output': 'created'})
        self.assertEqual(result.returncode, 0)
        self.assertIn('工单状态提醒', result.stdout)
        self.assertFalse(result.stdout.lstrip().startswith('{'))

    def test_irrelevant_and_no_issue_commands_are_silent(self):
        for command in ('ls -la', 'scripts/start-task-worktree.sh --no-issue'):
            with self.subTest(command=command):
                result = self.run_hook({'tool_name': 'Bash',
                                        'tool_input': {'command': command},
                                        'tool_response': {'exit_code': 0}})
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')

    def test_failed_and_unknown_events_are_silent(self):
        for tool, tool_input in (
                ('Bash', {'command': 'scripts/start-task-worktree.sh --issue IKJIU7'}),
                ('mcp__gitee-ent__create_enterprise_repo_pull', {}),
                ('mcp__gitee-ent__merge_enterprise_pull', {})):
            for response in (None, {}, {'isError': True}, {'isError': 'false'},
                             {'exit_code': 1}, {'exit_code': 1, 'isError': False}):
                with self.subTest(tool=tool, response=response):
                    payload = {'tool_name': tool, 'tool_input': tool_input}
                    if response is not None:
                        payload['tool_response'] = response
                    result = self.run_hook(payload)
                    self.assertEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, '')

    def test_worktree_uses_current_authority_and_preserves_recovery_boundary(self):
        result = self.run_hook({'tool_name': 'Bash', 'tool_input': {
            'command': 'bash scripts/start-task-worktree.sh --issue IKJIU7'},
            'tool_response': {'exit_code': 0}})
        context = json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
        self.assertIn('gitee-workflow-agent.md', context)
        self.assertIn('交接不明', context)
        self.assertNotIn('已完成', context)
        self.assertNotIn('已修复', context)

    def test_kimi_failure_event_and_malformed_payload_are_silent(self):
        result = self.run_hook({'tool_name': 'mcp__gitee-ent__merge_enterprise_pull',
                                'client_type': 'kimi_code_cli',
                                'hook_event_name': 'PostToolUseFailure',
                                'tool_output': 'failed'})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        for payload in ([], None, 'not an object'):
            result = self.run_hook(payload)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')

    def test_codex_wrapper_delivers_same_success_context(self):
        payload = json.dumps({'tool_name': 'mcp__gitee-ent__merge_enterprise_pull',
                              'tool_response': {'isError': False}})
        result = subprocess.run([BASH, str(ROOT / '.codex/hooks/run-claude-pretool.sh'),
                                 SCRIPT.name], input=payload, cwd=ROOT,
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        context = json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
        self.assertIn('保持业务状态', context)

    def test_quoted_worktree_command_and_issue_are_recognized(self):
        result = self.run_hook({'tool_name': 'Bash', 'tool_input': {
            'command': 'bash "scripts/start-task-worktree.sh" --issue "IKJIU7"'},
            'tool_response': {'exit_code': 0}})
        context = json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
        self.assertIn('IKJIU7', context)

    def test_merely_printing_an_entry_command_is_silent(self):
        result = self.run_hook({'tool_name': 'Bash', 'tool_input': {
            'command': 'echo scripts/start-task-worktree.sh --issue IKJIU7'},
            'tool_response': {'exit_code': 0}})
        self.assertEqual(result.stdout, '')

    def test_compound_result_does_not_prove_entry_success(self):
        for command in (
                'false && scripts/start-task-worktree.sh --issue IKJIU7; true',
                'scripts/start-task-worktree.sh --issue IKJIU7 || true',
                'bash -lc "scripts/start-task-worktree.sh --issue IKJIU7 || true"',
                'scripts/start-task-worktree.sh --issue IKJIU7 & wait',
                'bash -n scripts/start-task-worktree.sh --issue IKJIU7',
                'bash --version scripts/start-task-worktree.sh --issue IKJIU7'):
            with self.subTest(command=command):
                result = self.run_hook({'tool_name': 'Bash', 'tool_input': {
                    'command': command}, 'tool_response': {'exit_code': 0}})
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')

    def test_entry_help_does_not_prove_worktree_creation(self):
        for flag in ('--help', '-h'):
            with self.subTest(flag=flag):
                result = self.run_hook({'tool_name': 'Bash', 'tool_input': {
                    'command': f'scripts/start-task-worktree.sh {flag} --issue IKJIU7'},
                    'tool_response': {'exit_code': 0}})
                self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
