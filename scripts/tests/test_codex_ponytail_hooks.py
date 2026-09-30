import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class CodexPonytailHooksTest(unittest.TestCase):
    def test_project_lifecycle(self):
        hooks = json.loads((ROOT / '.codex/hooks.json').read_text())['hooks']
        with tempfile.TemporaryDirectory(prefix='codex ponytail ') as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q', directory], check=True)
            shutil.copytree(ROOT / '.claude/hooks', root / '.claude/hooks')
            env = dict(os.environ, PONYTAIL_DEFAULT_MODE='full',
                       XDG_CONFIG_HOME=str(root / 'config'))
            for key in ['COPILOT_PLUGIN_DATA', 'CLAUDE_PLUGIN_ROOT',
                        'QODER_SESSION_ID', 'CURSOR_VERSION', 'PONYTAIL_SUBAGENT_MATCHER']:
                env.pop(key, None)

            def run(event, prompt=''):
                commands = [h['command'] for entry in hooks[event]
                            for h in entry['hooks'] if 'ponytail-' in h['command']]
                self.assertEqual(len(commands), 1)
                result = subprocess.run(commands[0], shell=True, cwd=root, env=env,
                                        input=json.dumps({'prompt': prompt, 'agent_type': 'worker'}),
                                        text=True, capture_output=True, timeout=5, check=True)
                self.assertEqual(result.stderr, '')
                if not result.stdout:
                    return ''
                output = json.loads(result.stdout)
                specific = output.get('hookSpecificOutput', {})
                if specific:
                    self.assertEqual(specific['hookEventName'], event)
                return specific.get('additionalContext', '')

            self.assertIn('PONYTAIL MODE ACTIVE', run('SessionStart'))
            state = root / '.git/ponytail-codex/.ponytail-active'
            self.assertEqual(state.read_text(), 'full')
            self.assertIn('level: full', run('SubagentStart'))
            self.assertEqual(run('UserPromptSubmit', 'ordinary request'), '')
            for mode in ['lite', 'ultra', 'full']:
                self.assertIn('level: ' + mode, run('UserPromptSubmit', '@ponytail ' + mode))
                self.assertEqual(state.read_text(), mode)
                self.assertIn('level: ' + mode, run('SubagentStart'))
            self.assertIn('PONYTAIL MODE OFF', run('UserPromptSubmit', '@ponytail off'))
            self.assertFalse(state.exists())
            self.assertEqual(run('SubagentStart'), '')
            env['PONYTAIL_DEFAULT_MODE'] = 'off'
            self.assertEqual(run('SessionStart'), '')
            self.assertFalse(state.exists())


if __name__ == '__main__':
    unittest.main()
