import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
CLIENT_CONFIGS = {'codex': '.codex/hooks.json', 'claude': '.claude/settings.json'}
BODY_PROBE = '真实共享技能正文探针，必须由当前项目技能文件加载。'


class PonytailConfigHarness(unittest.TestCase):
    CLIENT_CONFIGS = CLIENT_CONFIGS
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='ponytail 配置链 ')
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        self.root = self.install_project('project')
        self.home = self.base / 'user'
        self.home.mkdir()
        self.env = dict(os.environ, HOME=str(self.home),
                        XDG_CONFIG_HOME=str(self.home / 'config'),
                        CLAUDE_CONFIG_DIR=str(self.home / '.claude'))
        for key in ['PLUGIN_DATA', 'COPILOT_PLUGIN_DATA', 'CLAUDE_PLUGIN_ROOT',
                    'QODER_SESSION_ID', 'CURSOR_VERSION', 'PONYTAIL_SUBAGENT_MATCHER',
                    'PONYTAIL_DEFAULT_MODE', 'PONYTAIL_QUIET_STARTUP', 'PONYTAIL_HIDE_STATUS',
                    'PONYTAIL_CLIENT', 'PONYTAIL_PROJECT_DIR', 'PONYTAIL_STATE_DIR',
                    'PONYTAIL_MAP', 'PONYTAIL_MAP_CHARS', 'CODEBUDDY_PLUGIN_ROOT']:
            self.env.pop(key, None)

    def install_project(self, name):
        root = self.base / name
        root.mkdir()
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        shutil.copytree(ROOT / '.claude/hooks', root / '.claude/hooks')
        shutil.copytree(ROOT / '.claude/commands', root / '.claude/commands')
        for file in self.CLIENT_CONFIGS.values():
            target = root / file
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / file, target)
        for skill in (ROOT / '.agents/skills').glob('ponytail*'):
            shutil.copytree(skill, root / '.agents/skills' / skill.name)
        (root / '.claude/skills').symlink_to('../.agents/skills')
        skill = root / '.agents/skills/ponytail/SKILL.md'
        skill.write_text(skill.read_text() + '\n' + BODY_PROBE + '\n')
        return root

    def configured_handlers(self, client, event, root):
        config = json.loads((root / self.CLIENT_CONFIGS[client]).read_text())
        return [hook for entry in config['hooks'][event] for hook in entry['hooks']
                if 'ponytail-' in hook['command']]

    def run_hook(self, client, event, prompt='', root=None, **payload):
        root = root or self.root
        handlers = self.configured_handlers(client, event, root)
        self.assertEqual(len(handlers), 1)
        env = dict(self.env, CLAUDE_PROJECT_DIR=str(root))
        result = subprocess.run(handlers[0]['command'], shell=True, cwd=root, env=env,
                                input=json.dumps({'cwd': str(root), 'prompt': prompt,
                                                  'agent_type': 'worker', **payload}),
                                text=True, capture_output=True, timeout=10, check=True)
        self.assertEqual(result.stderr, '')
        return self.context_output(client, event, result.stdout)

    def context_output(self, client, event, stdout):
        if not stdout:
            return ''
        if client == 'codex' or event == 'SubagentStart':
            output = json.loads(stdout)
            if client == 'codex':
                self.assertNotIn('systemMessage', output)
            specific = output.get('hookSpecificOutput', {})
            if specific:
                self.assertEqual(specific['hookEventName'], event)
            return specific.get('additionalContext', '')
        return stdout

    def assert_mode(self, output, mode):
        self.assertIn('level: ' + mode, output)
        self.assertIn(BODY_PROBE, output)
        self.assertIn('完整处理受影响的调用方、测试和夹具', output)
        self.assertIn('禁止新增普通代码注释', output)
        self.assertIn('结构探索先走 CBM', output)
        self.assertIn('| **' + mode + '** |', output)
        for other in {'lite', 'full', 'ultra'} - {mode}:
            self.assertNotIn('| **' + other + '** |', output)


class PonytailHooksTest(PonytailConfigHarness):
    def test_codex_desktop_skill_reference_switches_reports_and_restores_current_mode(self):
        root = self.install_project('桌面 中文工作树')
        reference = '[$ponytail](' + str(root.resolve() / '.agents/skills/ponytail/SKILL.md') + ')'
        self.assert_mode(self.run_hook('codex', 'SessionStart', root=root), 'full')
        for mode in ['lite', 'full', 'ultra']:
            self.assert_mode(self.run_hook('codex', 'UserPromptSubmit', reference + ' ' + mode + '\n',
                                           root=root), mode)
            self.assert_mode(self.run_hook('codex', 'SubagentStart', root=root), mode)
        report = self.run_hook('codex', 'UserPromptSubmit', reference + '\n', root=root)
        self.assertIn('level: ultra', report)
        self.assertNotIn(BODY_PROBE, report)
        self.env['PONYTAIL_DEFAULT_MODE'] = 'lite'
        self.assertIn('PONYTAIL MODE OFF', self.run_hook('codex', 'UserPromptSubmit',
                                                       reference + ' off\n', root=root))
        self.assertEqual(self.run_hook('codex', 'UserPromptSubmit', '普通开发请求', root=root), '')
        self.assertEqual(self.run_hook('codex', 'SubagentStart', root=root), '')
        self.assert_mode(self.run_hook('codex', 'UserPromptSubmit', reference + '\n', root=root), 'lite')
        self.env['PONYTAIL_DEFAULT_MODE'] = 'off'
        self.assertEqual(self.run_hook('codex', 'SessionStart', root=root), '')
        self.assert_mode(self.run_hook('codex', 'UserPromptSubmit', reference, root=root), 'full')
        self.assert_mode(self.run_hook('codex', 'UserPromptSubmit', '$ponytail ultra', root=root), 'ultra')

    def test_codex_desktop_skill_reference_rejects_wrong_targets_and_preserves_one_shot_modes(self):
        skill = self.root.resolve() / '.agents/skills/ponytail/SKILL.md'
        reference = '[$ponytail](' + str(skill) + ')'
        other = self.install_project('其他 中文工作树')
        self.run_hook('codex', 'SessionStart')
        self.assert_mode(self.run_hook('codex', 'UserPromptSubmit', '$ponytail ultra'), 'ultra')
        invalid = [
            reference + ' bogus',
            reference + ' full extra',
            reference + ' default review',
            reference + ' default lite extra',
            reference + 'lite',
            '[$ponytail](' + str(other.resolve() / '.agents/skills/ponytail/SKILL.md') + ') lite',
            '[$ponytail](' + str(skill.with_name('skill.md')) + ') lite',
            '[$ponytail](' + str(self.root.resolve() / '.agents/skills/ponytail-help/SKILL.md') + ') lite',
            '请使用 ' + reference + ' lite',
            '```text\n' + reference + ' lite\n```',
            '<span>' + reference + ' lite</span>',
        ]
        for prompt in invalid:
            with self.subTest(prompt=prompt):
                self.assertEqual(self.run_hook('codex', 'UserPromptSubmit', prompt), '')
                self.assert_mode(self.run_hook('codex', 'SubagentStart'), 'ultra')
        for suffix in ['review', 'audit', 'debt', 'gain', 'help']:
            target = self.root.resolve() / '.agents/skills' / ('ponytail-' + suffix) / 'SKILL.md'
            prompt = '[$ponytail-' + suffix + '](' + str(target) + ')\n'
            self.assertEqual(self.run_hook('codex', 'UserPromptSubmit', prompt), '')
            self.assert_mode(self.run_hook('codex', 'SubagentStart'), 'ultra')
        self.assert_mode(self.run_hook('claude', 'SessionStart'), 'full')
        self.assertEqual(self.run_hook('claude', 'UserPromptSubmit', reference + ' lite'), '')
        self.assert_mode(self.run_hook('claude', 'SubagentStart'), 'full')
        self.assertIn('默认值已设置为 lite',
                      self.run_hook('codex', 'UserPromptSubmit', reference + ' default lite'))
        self.assert_mode(self.run_hook('codex', 'SubagentStart'), 'ultra')
        self.assert_mode(self.run_hook('codex', 'SessionStart'), 'lite')

    def test_real_config_delivers_body_on_start_switch_and_subagent(self):
        for client in self.CLIENT_CONFIGS:
            with self.subTest(client=client):
                self.assert_mode(self.run_hook(client, 'SessionStart'), 'full')
                for mode in ['lite', 'ultra', 'full']:
                    command = ('$' if client == 'codex' else '/') + 'ponytail ' + mode
                    self.assert_mode(self.run_hook(client, 'UserPromptSubmit', command), mode)
                    self.assert_mode(self.run_hook(client, 'SubagentStart'), mode)
                    self.run_hook(client, 'UserPromptSubmit', '普通开发请求')
                    self.assert_mode(self.run_hook(client, 'SubagentStart'), mode)

    def test_off_bare_resume_invalid_arguments_and_one_shots(self):
        for client in self.CLIENT_CONFIGS:
            prefix = '$' if client == 'codex' else '/'
            with self.subTest(client=client):
                self.env['PONYTAIL_DEFAULT_MODE'] = 'lite'
                self.assert_mode(self.run_hook(client, 'SessionStart'), 'lite')
                self.run_hook(client, 'UserPromptSubmit', prefix + 'ponytail ultra')
                for suffix in ['review', 'audit', 'debt', 'gain', 'help']:
                    self.run_hook(client, 'UserPromptSubmit', prefix + 'ponytail-' + suffix)
                    self.assert_mode(self.run_hook(client, 'SubagentStart'), 'ultra')
                for command in [prefix + 'ponytail bogus', prefix + 'ponytail full extra',
                                prefix + 'ponytail default review', '添加 normal mode 按钮']:
                    self.run_hook(client, 'UserPromptSubmit', command)
                    self.assert_mode(self.run_hook(client, 'SubagentStart'), 'ultra')
                report = self.run_hook(client, 'UserPromptSubmit', prefix + 'ponytail')
                self.assertIn('level: ultra', report)
                for command in [prefix + 'ponytail off', 'stop ponytail.', 'normal mode!']:
                    self.run_hook(client, 'UserPromptSubmit', command)
                    self.run_hook(client, 'UserPromptSubmit', '普通开发请求')
                    self.assertEqual(self.run_hook(client, 'SubagentStart'), '')
                    self.assert_mode(self.run_hook(client, 'UserPromptSubmit', prefix + 'ponytail'), 'lite')
                self.env['PONYTAIL_DEFAULT_MODE'] = 'off'
                self.assertEqual(self.run_hook(client, 'SessionStart'), '')
                self.assert_mode(self.run_hook(client, 'UserPromptSubmit', prefix + 'ponytail'), 'full')

    def test_default_resolution_and_explicit_default_only_changes_next_start(self):
        config = self.home / 'config/ponytail/config.json'
        config.parent.mkdir(parents=True)
        for client in self.CLIENT_CONFIGS:
            prefix = '$' if client == 'codex' else '/'
            for mode in ['off', 'lite', 'full', 'ultra']:
                with self.subTest(client=client, mode=mode):
                    config.write_text(json.dumps({'defaultMode': mode, 'preserved': True}))
                    output = self.run_hook(client, 'SessionStart')
                    if mode == 'off':
                        self.assertEqual(output, '')
                    else:
                        self.assert_mode(output, mode)
                    self.env['PONYTAIL_DEFAULT_MODE'] = ' FuLL '
                    self.assert_mode(self.run_hook(client, 'SessionStart'), 'full')
                    del self.env['PONYTAIL_DEFAULT_MODE']
                    self.run_hook(client, 'UserPromptSubmit', prefix + 'ponytail ultra')
                    self.assertEqual(json.loads(config.read_text())['defaultMode'], mode)
                    self.run_hook(client, 'UserPromptSubmit', prefix + 'ponytail default lite')
                    self.assert_mode(self.run_hook(client, 'SubagentStart'), 'ultra')
                    self.assertEqual(json.loads(config.read_text()), {'defaultMode': 'lite', 'preserved': True})
                    self.assert_mode(self.run_hook(client, 'SessionStart'), 'lite')
        for value in ['review', 7, None]:
            config.write_text(json.dumps({'defaultMode': value}))
            self.assert_mode(self.run_hook('codex', 'SessionStart'), 'full')

    def test_clients_projects_and_linked_worktrees_keep_modes_independent(self):
        other = self.install_project('other')
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'user.name=测试', '-c', 'user.email=test@example.invalid',
                        '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'],
                       cwd=self.root, check=True)
        worktree = self.base / 'linked'
        subprocess.run(['git', 'worktree', 'add', '-qb', 'fixture-worktree', str(worktree)],
                       cwd=self.root, check=True, capture_output=True)
        for project in [self.root, other, worktree]:
            for client in self.CLIENT_CONFIGS:
                self.assert_mode(self.run_hook(client, 'SessionStart', root=project), 'full')
        self.run_hook('claude', 'UserPromptSubmit', '/ponytail ultra')
        self.run_hook('codex', 'UserPromptSubmit', '$ponytail lite', root=worktree)
        self.run_hook('claude', 'UserPromptSubmit', '/ponytail off', root=other)
        self.assert_mode(self.run_hook('claude', 'SubagentStart'), 'ultra')
        self.assert_mode(self.run_hook('codex', 'SubagentStart'), 'full')
        self.assert_mode(self.run_hook('codex', 'SubagentStart', root=worktree), 'lite')
        self.assert_mode(self.run_hook('claude', 'SubagentStart', root=worktree), 'full')
        self.assertEqual(self.run_hook('claude', 'SubagentStart', root=other), '')
        self.assert_mode(self.run_hook('codex', 'SubagentStart', root=other), 'full')

    def test_statusline_uses_current_worktree_and_preserves_user_settings(self):
        settings = self.home / '.claude/settings.json'
        settings.parent.mkdir(parents=True)
        original = json.dumps({'statusLine': {'type': 'command', 'command': 'printf existing'},
                               'preserved': True})
        settings.write_text(original)
        output = self.run_hook('claude', 'SessionStart')
        self.assertNotIn('Ponytail 状态栏配置', output)
        self.assertEqual(settings.read_text(), original)
        settings.unlink()
        output = self.run_hook('claude', 'SessionStart')
        self.assertIn('Ponytail 状态栏配置', output)
        self.assertIn('.claude/hooks/ponytail-statusline.js', output)
        other = self.install_project('statusline-other')
        self.run_hook('claude', 'SessionStart', root=other)
        self.run_hook('claude', 'UserPromptSubmit', '/ponytail ultra', root=other)
        self.run_hook('claude', 'UserPromptSubmit', '/ponytail lite')

        def badge(root):
            env = dict(self.env, PONYTAIL_CLIENT='claude')
            result = subprocess.run(['node', str(root / '.claude/hooks/ponytail-statusline.js')],
                                    input=json.dumps({'workspace': {'project_dir': str(root)}}),
                                    cwd=self.base, env=env, text=True, capture_output=True,
                                    check=True, timeout=10)
            self.assertEqual(result.stderr, '')
            return result.stdout

        self.assertIn('[PONYTAIL:LITE]', badge(self.root))
        self.assertIn('[PONYTAIL:ULTRA]', badge(other))
        self.run_hook('claude', 'UserPromptSubmit', '/ponytail off')
        self.assertEqual(badge(self.root), '')
        self.assertFalse(settings.exists())

    def test_missing_skill_is_reported_and_cannot_pass_body_acceptance(self):
        (self.root / '.agents/skills/ponytail/SKILL.md').unlink()
        for client in self.CLIENT_CONFIGS:
            output = self.run_hook(client, 'SessionStart')
            self.assertIn('共享技能缺失', output)
            self.assertNotIn(BODY_PROBE, output)
            self.assertIn('中文', output)
            self.assertIn('CBM', output)
            self.assertIn('本仓测试框架', output)
            self.assertIn('禁止新增普通代码注释', output)

    def test_map_dependency_and_local_skill_and_command_discovery(self):
        source = self.root / 'lib/helpers.js'
        source.parent.mkdir()
        source.write_text('export function reusedHelper() { return 7; }\n')
        subprocess.run(['git', 'add', 'lib'], cwd=self.root, check=True)
        for client in self.CLIENT_CONFIGS:
            output = self.run_hook(client, 'SessionStart')
            self.assertIn('reusedHelper', output)
            self.assertIn('结构查询仍先走 CBM', output)
        for name in ['ponytail', 'ponytail-review', 'ponytail-audit', 'ponytail-debt',
                     'ponytail-gain', 'ponytail-help']:
            self.assertEqual((self.root / '.agents/skills' / name / 'SKILL.md').read_bytes(),
                             (self.root / '.claude/skills' / name / 'SKILL.md').read_bytes())
            command = self.root / '.claude/commands' / (name + '.md')
            self.assertIn('.agents/skills/' + name + '/SKILL.md', command.read_text())
        debt = self.root / '.agents/skills/ponytail-debt/SKILL.md'
        command = debt.read_text().split('```bash\n')[1].split('\n```')[0]
        (self.root / 'legacy.py').write_text('# ponytail: known limit, trigger\n')
        (self.root / 'legacy.js').write_text('// shortcut: known limit, trigger\n')
        result = subprocess.run(command, shell=True, cwd=self.root, text=True,
                                capture_output=True, check=True, timeout=10)
        self.assertIn('legacy.py:1:', result.stdout)
        self.assertIn('legacy.js:1:', result.stdout)

    def test_explicit_clients_ignore_inherited_host_detection_and_filter_subagents(self):
        self.env.update(COPILOT_PLUGIN_DATA=str(self.home / 'copilot'),
                        QODER_SESSION_ID='parent', CURSOR_VERSION='parent')
        for client in self.CLIENT_CONFIGS:
            self.assert_mode(self.run_hook(client, 'SessionStart'), 'full')
            self.env['PONYTAIL_SUBAGENT_MATCHER'] = '^worker$'
            self.assertEqual(self.run_hook(client, 'SubagentStart', agent_type='explorer'), '')
            self.assert_mode(self.run_hook(client, 'SubagentStart'), 'full')
            del self.env['PONYTAIL_SUBAGENT_MATCHER']


if __name__ == '__main__':
    unittest.main()
