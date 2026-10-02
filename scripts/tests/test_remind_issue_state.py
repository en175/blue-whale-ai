import json
import subprocess
import unittest
from pathlib import Path

from bash_helper import BASH

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / '.claude/hooks/remind-issue-state.sh'


class RemindIssueStateTest(unittest.TestCase):
    """锁定提醒输出通道：非 kimi 端必须以 hookSpecificOutput.additionalContext
    JSON 注入（裸 stdout 不进入模型上下文），kimi 端纯文本，恒 exit 0。"""

    def run_hook(self, payload):
        return subprocess.run([BASH, str(SCRIPT)], input=json.dumps(payload),
                              text=True, capture_output=True, timeout=10)

    def test_worktree_entry_reminder_is_injected_json(self):
        result = self.run_hook({'tool_name': 'Bash', 'tool_input': {
            'command': 'scripts/start-task-worktree.sh --issue IKJIU7 fix/x'}})
        self.assertEqual(result.returncode, 0)
        specific = json.loads(result.stdout)['hookSpecificOutput']
        self.assertEqual(specific['hookEventName'], 'PostToolUse')
        self.assertIn('工单状态提醒', specific['additionalContext'])
        self.assertIn('IKJIU7', specific['additionalContext'])

    def test_pr_and_merge_reminders_inject_json(self):
        for tool in ('mcp__gitee-ent__create_enterprise_repo_pull',
                     'mcp__gitee-ent__merge_enterprise_pull'):
            with self.subTest(tool=tool):
                result = self.run_hook({'tool_name': tool, 'tool_input': {}})
                self.assertEqual(result.returncode, 0)
                specific = json.loads(result.stdout)['hookSpecificOutput']
                self.assertEqual(specific['hookEventName'], 'PostToolUse')
                self.assertIn('additionalContext', specific)

    def test_kimi_client_receives_plain_text(self):
        result = self.run_hook({
            'tool_name': 'Bash', 'client_type': 'kimi_code_cli',
            'tool_input': {'command': 'scripts/start-task-worktree.sh --issue IKJIU7'}})
        self.assertEqual(result.returncode, 0)
        self.assertIn('工单状态提醒', result.stdout)
        self.assertFalse(result.stdout.lstrip().startswith('{'))

    def test_irrelevant_and_no_issue_commands_are_silent(self):
        for command in ('ls -la', 'scripts/start-task-worktree.sh --no-issue'):
            with self.subTest(command=command):
                result = self.run_hook({'tool_name': 'Bash',
                                        'tool_input': {'command': command}})
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
