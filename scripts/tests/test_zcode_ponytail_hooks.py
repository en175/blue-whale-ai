import json
import shlex
import shutil
import subprocess
import unittest

from test_codex_ponytail_hooks import BODY_PROBE, ROOT, PonytailConfigHarness


class ZcodePonytailHooksTest(PonytailConfigHarness):
    CLIENT_CONFIGS = {**PonytailConfigHarness.CLIENT_CONFIGS, 'zcode': '.zcode/config.json'}

    def configured_handlers(self, client, event, root):
        if client != 'zcode':
            return super().configured_handlers(client, event, root)
        config = json.loads((root / self.CLIENT_CONFIGS[client]).read_text())
        return [hook for entry in config['hooks']['events'][event] for hook in entry['hooks']
                if 'ponytail-' in hook['command']]

    def context_output(self, client, event, stdout):
        if client != 'zcode':
            return super().context_output(client, event, stdout)
        output = json.loads(stdout)
        self.assertIsInstance(output, dict)
        self.assertNotIn('systemMessage', output)
        specific = output.get('hookSpecificOutput', {})
        if specific:
            self.assertEqual(specific['hookEventName'], event)
            self.assertIsInstance(specific['additionalContext'], str)
        return specific.get('additionalContext', '')

    def assert_mode(self, output, mode):
        self.assertIn('level: ' + mode, output)
        self.assertIn(BODY_PROBE, output)
        self.assertIn('完整处理受影响的调用方、测试和夹具', output)
        self.assertIn('禁止新增普通代码注释', output)
        self.assertIn('结构探索先走 CBM', output)
        self.assertIn('| **' + mode + '** |', output)
        for other in {'lite', 'full', 'ultra'} - {mode}:
            self.assertNotIn('| **' + other + '** |', output)

    def test_real_config_delivers_json_body_on_start_and_switch(self):
        self.assert_mode(self.run_hook('zcode', 'SessionStart'), 'full')
        for mode in ['lite', 'ultra', 'full']:
            self.assert_mode(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail ' + mode), mode)

    def test_default_resolution_and_explicit_default_only_changes_next_start(self):
        config = self.home / 'config/ponytail/config.json'
        config.parent.mkdir(parents=True)
        for mode in ['off', 'lite', 'full', 'ultra']:
            with self.subTest(mode=mode):
                config.write_text(json.dumps({'defaultMode': mode, 'preserved': True}))
                output = self.run_hook('zcode', 'SessionStart')
                if mode == 'off':
                    self.assertEqual(output, '')
                    self.assertEqual(self.run_hook('zcode', 'UserPromptSubmit', '普通开发请求'), '')
                else:
                    self.assert_mode(output, mode)
                self.env['PONYTAIL_DEFAULT_MODE'] = ' FuLL '
                self.assert_mode(self.run_hook('zcode', 'SessionStart'), 'full')
                del self.env['PONYTAIL_DEFAULT_MODE']
                self.assert_mode(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail ultra'), 'ultra')
                self.assertEqual(json.loads(config.read_text()), {'defaultMode': mode, 'preserved': True})
                self.run_hook('zcode', 'UserPromptSubmit', '/ponytail default lite')
                self.assertIn('level: ultra', self.run_hook('zcode', 'UserPromptSubmit', '/ponytail'))
                self.assertEqual(json.loads(config.read_text()), {'defaultMode': 'lite', 'preserved': True})
                self.assert_mode(self.run_hook('zcode', 'SessionStart'), 'lite')
        for value in ['review', 7, None]:
            config.write_text(json.dumps({'defaultMode': value}))
            self.assert_mode(self.run_hook('zcode', 'SessionStart'), 'full')

    def test_off_bare_resume_invalid_arguments_and_one_shots_keep_scope(self):
        self.env['PONYTAIL_DEFAULT_MODE'] = 'lite'
        self.assert_mode(self.run_hook('zcode', 'SessionStart'), 'lite')
        self.assert_mode(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail ultra'), 'ultra')
        for prefix in ['/', '$', '@']:
            for suffix in ['review', 'audit', 'debt', 'gain', 'help']:
                self.run_hook('zcode', 'UserPromptSubmit', prefix + 'ponytail-' + suffix)
                self.assertIn('level: ultra', self.run_hook('zcode', 'UserPromptSubmit', '/ponytail'))
        for command in ['/ponytail bogus', '/ponytail full extra', '/ponytail review',
                        '/ponytail default review', '/ponytail default lite extra',
                        '添加 normal mode 按钮']:
            self.run_hook('zcode', 'UserPromptSubmit', command)
            self.assertIn('level: ultra', self.run_hook('zcode', 'UserPromptSubmit', '/ponytail'))
        for command in ['/ponytail off', 'stop ponytail.', 'normal mode!']:
            output = self.run_hook('zcode', 'UserPromptSubmit', command)
            self.assertIn('PONYTAIL MODE OFF', output)
            self.assertEqual(self.run_hook('zcode', 'UserPromptSubmit', '普通开发请求'), '')
            for suffix in ['review', 'audit', 'debt', 'gain', 'help']:
                self.assertEqual(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail-' + suffix), '')
            self.assert_mode(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail'), 'lite')
        self.env['PONYTAIL_DEFAULT_MODE'] = 'off'
        self.assertEqual(self.run_hook('zcode', 'SessionStart'), '')
        self.assert_mode(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail'), 'full')

    def test_clients_projects_and_linked_worktrees_keep_modes_independent(self):
        other = self.install_project('other')
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'user.name=测试', '-c', 'user.email=test@example.invalid',
                        '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'],
                       cwd=self.root, check=True)
        linked = self.base / 'linked'
        subprocess.run(['git', 'worktree', 'add', '-qb', 'fixture-worktree', str(linked)],
                       cwd=self.root, check=True, capture_output=True)
        self.env.update(PLUGIN_DATA=str(self.home / 'codex'), QODER_SESSION_ID='parent',
                        COPILOT_PLUGIN_DATA=str(self.home / 'copilot'),
                        PONYTAIL_CLIENT='kimi', PONYTAIL_PROJECT_DIR=str(other))
        for project in [self.root, other, linked]:
            for client in self.CLIENT_CONFIGS:
                self.assert_mode(self.run_hook(client, 'SessionStart', root=project), 'full')
        self.run_hook('zcode', 'UserPromptSubmit', '/ponytail ultra')
        self.run_hook('zcode', 'UserPromptSubmit', '/ponytail off', root=other)
        self.run_hook('zcode', 'UserPromptSubmit', '/ponytail lite', root=linked)
        self.run_hook('claude', 'UserPromptSubmit', '/ponytail lite')
        self.run_hook('codex', 'UserPromptSubmit', '$ponytail ultra', root=other)
        self.assertIn('level: ultra', self.run_hook('zcode', 'UserPromptSubmit', '/ponytail'))
        self.assertEqual(self.run_hook('zcode', 'UserPromptSubmit', '普通开发请求', root=other), '')
        self.assertIn('level: lite', self.run_hook('zcode', 'UserPromptSubmit', '/ponytail', root=linked))
        self.assert_mode(self.run_hook('claude', 'SubagentStart'), 'lite')
        self.assert_mode(self.run_hook('codex', 'SubagentStart'), 'full')
        self.assert_mode(self.run_hook('codex', 'SubagentStart', root=other), 'ultra')
        self.assert_mode(self.run_hook('claude', 'SubagentStart', root=other), 'full')
        for client in ['claude', 'codex']:
            self.assert_mode(self.run_hook(client, 'SubagentStart', root=linked), 'full')
        nested = self.root / 'nested'
        nested.mkdir()
        self.assert_mode(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail lite', cwd=str(nested)), 'lite')
        self.assertIn('level: lite', self.run_hook('zcode', 'UserPromptSubmit', '/ponytail'))
        self.assertIn('level: lite', self.run_hook('zcode', 'UserPromptSubmit', '/ponytail', root=linked))

    def test_event_whitelist_and_missing_skill_are_reported(self):
        config = json.loads((self.root / '.zcode/config.json').read_text())
        self.assertTrue(config['hooks']['enabled'])
        self.assertTrue(set(config['hooks']['events']) <= {
            'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
            'PostToolUse', 'PostToolUseFailure', 'Stop',
        })
        ponytail_events = {event for event in config['hooks']['events']
                          if self.configured_handlers('zcode', event, self.root)}
        self.assertEqual(ponytail_events, {'SessionStart', 'UserPromptSubmit'})
        (self.root / '.agents/skills/ponytail/SKILL.md').unlink()
        output = self.run_hook('zcode', 'SessionStart')
        self.assertIn('共享技能缺失', output)
        self.assertNotIn(BODY_PROBE, output)
        self.assertIn('中文', output)
        self.assertIn('CBM', output)
        self.assertIn('本仓测试框架', output)
        self.assertIn('禁止新增普通代码注释', output)


class ZcodePluginPonytailHooksTest(ZcodePonytailHooksTest):
    def setUp(self):
        super().setUp()
        market_root = ROOT / '.zcode/plugins'
        market = json.loads((market_root / 'marketplace.json').read_text())
        self.assertEqual(len(market['plugins']), 1)
        entry = market['plugins'][0]
        source = market_root / entry['source']
        self.plugin = self.base / 'installed-plugin'
        shutil.copytree(source, self.plugin)
        manifest = json.loads((self.plugin / '.zcode-plugin/plugin.json').read_text())
        self.assertEqual(manifest['name'], entry['name'])
        self.assertEqual(manifest['version'], entry['version'])
        self.assertNotIn('hooks', manifest)

    def install_project(self, name):
        root = super().install_project(name)
        marker = ROOT / '.zcode/ponytail.json'
        if marker.exists():
            shutil.copyfile(marker, root / '.zcode/ponytail.json')
        return root

    def configured_handlers(self, client, event, root):
        if client != 'zcode':
            return super().configured_handlers(client, event, root)
        config = json.loads((self.plugin / 'hooks/hooks.json').read_text())
        handlers = [hook for entry in config['hooks'].get(event, []) for hook in entry['hooks']]
        result = []
        for hook in handlers:
            self.assertEqual(hook['type'], 'process')
            args = [arg.replace('${ZCODE_PLUGIN_ROOT}', str(self.plugin)) for arg in hook['args']]
            result.append({**hook, 'command': shlex.join([hook['command'], *args])})
        return result

    def test_plugin_has_supported_events_and_other_projects_stay_quiet(self):
        config = json.loads((self.plugin / 'hooks/hooks.json').read_text())
        self.assertEqual(set(config['hooks']), {'SessionStart', 'UserPromptSubmit'})
        self.assert_mode(self.run_hook('zcode', 'SessionStart'), 'full')
        for value in [{'enabled': False}, {}, None, []]:
            (self.root / '.zcode/ponytail.json').write_text(json.dumps(value))
            self.assertEqual(self.run_hook('zcode', 'SessionStart'), '')
            self.assertEqual(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail lite'), '')
        (self.root / '.zcode/ponytail.json').unlink()
        self.assertEqual(self.run_hook('zcode', 'SessionStart'), '')
        self.assertEqual(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail off'), '')
        outside = self.base / 'outside'
        outside.mkdir()
        self.assertEqual(self.run_hook('zcode', 'SessionStart', cwd=str(outside)), '')
        self.assertEqual(self.run_hook('zcode', 'UserPromptSubmit', '/ponytail ultra', cwd=str(outside)), '')


if __name__ == '__main__':
    unittest.main()
