import json
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
import unittest

from scripts.tests.test_codex_ponytail_hooks import BODY_PROBE, ROOT, PonytailConfigHarness


class KimiPonytailHooksTest(PonytailConfigHarness):
    def install_project(self, name):
        root = super().install_project(name)
        shutil.copytree(ROOT / '.kimi-code', root / '.kimi-code')
        (root / 'scripts').mkdir()
        shutil.copyfile(ROOT / 'scripts/install-kimi-hooks.sh', root / 'scripts/install-kimi-hooks.sh')
        return root

    def setUp(self):
        super().setUp()
        self.env['KIMI_CODE_HOME'] = str(self.home / '.kimi-code')
        self.env['PATH'] = str(Path(sys.executable).parent) + ':' + self.env['PATH']
        self.install()

    def install(self, *arguments, root=None):
        result = subprocess.run(['bash', str((root or self.root) / 'scripts/install-kimi-hooks.sh'),
                                 *arguments], cwd=root or self.root, env=self.env,
                                text=True, capture_output=True, timeout=30, check=True)
        return result.stdout + result.stderr

    def configured_handlers(self, client, event, root):
        if client != 'kimi':
            return super().configured_handlers(client, event, root)
        config = tomllib.loads((Path(self.env['KIMI_CODE_HOME']) / 'config.toml').read_text())
        return [hook for hook in config['hooks'] if hook['event'] == event
                and 'ponytail-' in hook['command']]

    def context_output(self, client, event, stdout):
        return stdout if client == 'kimi' else super().context_output(client, event, stdout)

    def assert_mode(self, output, mode):
        super().assert_mode(output, mode)
        self.assertEqual(output.count(BODY_PROBE), 1)

    def test_session_start_is_silent_and_prompt_receives_real_current_rules(self):
        self.assertEqual(self.run_hook('kimi', 'SessionStart'), '')
        self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '普通开发请求'), 'full')
        self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail lite'), 'lite')
        self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '下一次开发请求'), 'lite')
        self.assertEqual(self.run_hook('kimi', 'SessionStart', source='resume'), '')
        self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '新会话输入'), 'full')

    def test_install_update_migrate_and_uninstall_preserve_personal_configuration(self):
        config = Path(self.env['KIMI_CODE_HOME']) / 'config.toml'
        personal = ('default_model = "personal-model"\n\n'
                    '[[hooks]]\nevent = "UserPromptSubmit"\ncommand = \'printf personal\'\n\n')
        legacy = ''.join('[[hooks]]\nevent = "' + event + '"\n'
                         'command = \'node "$HOME/.config/ponytail/kimi-hook.js" ' + event + '\'\n'
                         'timeout = 5\n\n' for event in ['SessionStart', 'UserPromptSubmit'])
        unknown = ('[[hooks]]\nevent = "UserPromptSubmit"\n'
                   'command = \'node "$HOME/private/ponytail-hook.js"\'\ntimeout = 5\n')
        config.write_text(personal + legacy + unknown)
        report = self.install()
        hooks = tomllib.loads(config.read_text())['hooks']
        self.assertEqual(sum('kimi-hook.js' in hook['command'] for hook in hooks), 0)
        self.assertEqual(sum('hooks/ponytail-hook.js' in hook['command'] for hook in hooks), 2)
        self.assertIn(personal, config.read_text())
        self.assertIn(unknown, config.read_text())
        self.assertIn('归属不明', report)
        installed = config.read_bytes()
        self.install()
        self.assertEqual(config.read_bytes(), installed)
        shim = Path(self.env['KIMI_CODE_HOME']) / 'hooks/ponytail-hook.js'
        shim.write_text('obsolete installation')
        self.install()
        self.assertEqual(shim.read_bytes(), (self.root / '.kimi-code/hooks/ponytail-hook.js').read_bytes())
        self.install('--uninstall')
        self.assertEqual(config.read_text(), personal + unknown)
        self.assertFalse(shim.exists())
        self.install('--uninstall')
        self.assertEqual(config.read_text(), personal + unknown)

    def test_migration_handles_hooks_before_and_after_existing_managed_block(self):
        config = Path(self.env['KIMI_CODE_HOME']) / 'config.toml'
        managed = config.read_text()
        legacy = lambda event: ('[[hooks]]\nevent = "' + event + '"\n'
                                'command = \'node "$HOME/.config/ponytail/kimi-hook.js" ' + event + '\'\n'
                                'timeout = 5\n\n')
        personal = '[personal]\nmodel = "kept"\n'
        config.write_text(legacy('SessionStart') + managed + legacy('UserPromptSubmit') + personal)
        self.install()
        parsed = tomllib.loads(config.read_text())
        self.assertEqual(parsed['personal'], {'model': 'kept'})
        self.assertEqual(sum('kimi-hook.js' in hook['command'] for hook in parsed['hooks']), 0)
        self.assertEqual(sum('hooks/ponytail-hook.js' in hook['command'] for hook in parsed['hooks']), 2)
        self.install('--uninstall')
        self.assertEqual(tomllib.loads(config.read_text()), {'personal': {'model': 'kept'}})

    def test_ponytail_only_uninstall_preserves_security_and_reinstall_is_idempotent(self):
        config = Path(self.env['KIMI_CODE_HOME']) / 'config.toml'
        personal = ('default_model = "personal-model"\n\n'
                    '[[hooks]]\nevent = "UserPromptSubmit"\ncommand = \'printf personal\'\n\n')
        unknown = ('[[hooks]]\nevent = "UserPromptSubmit"\n'
                   'command = \'node "$HOME/private/ponytail-hook.js"\'\ntimeout = 5\n')
        config.write_text(personal + config.read_text() + unknown)
        installed = config.read_text()
        hooks = tomllib.loads(installed)['hooks']
        security = [hook for hook in hooks if 'blue-whale-hook.sh' in hook['command']]
        self.assertEqual(len(security), 17)
        shim_dir = Path(self.env['KIMI_CODE_HOME']) / 'hooks'
        security_shim = (shim_dir / 'blue-whale-hook.sh').read_bytes()
        default = self.home / 'config/ponytail/config.json'
        default.parent.mkdir(parents=True)
        default.write_text('{"defaultMode":"lite","preserved":true}')
        defaults = default.read_bytes()
        client_assets = {file: (self.root / file).read_bytes()
                         for file in ['.codex/hooks.json', '.claude/settings.json',
                                      '.agents/skills/ponytail/SKILL.md']}
        self.install('--uninstall-ponytail')
        remaining = tomllib.loads(config.read_text())['hooks']
        self.assertEqual([hook for hook in remaining if 'blue-whale-hook.sh' in hook['command']], security)
        self.assertEqual(sum('hooks/ponytail-hook.js' in hook['command'] for hook in remaining), 0)
        self.assertIn(personal, config.read_text())
        self.assertIn(unknown, config.read_text())
        self.assertIn(installed[installed.index('[[hooks]]\nevent = "PreToolUse"'):], config.read_text())
        self.assertFalse((shim_dir / 'ponytail-hook.js').exists())
        self.assertEqual((shim_dir / 'blue-whale-hook.sh').read_bytes(), security_shim)
        removed = config.read_bytes()
        self.install('--uninstall-ponytail')
        self.assertEqual(config.read_bytes(), removed)
        self.assertEqual((shim_dir / 'blue-whale-hook.sh').read_bytes(), security_shim)
        self.install()
        restored = config.read_bytes()
        self.assertEqual(sum('hooks/ponytail-hook.js' in hook['command']
                             for hook in tomllib.loads(config.read_text())['hooks']), 2)
        self.assertIn(personal, config.read_text())
        self.assertIn(unknown, config.read_text())
        self.assertEqual((shim_dir / 'ponytail-hook.js').read_bytes(),
                         (self.root / '.kimi-code/hooks/ponytail-hook.js').read_bytes())
        self.install()
        self.assertEqual(config.read_bytes(), restored)
        self.assertEqual(default.read_bytes(), defaults)
        for file, content in client_assets.items():
            self.assertEqual((self.root / file).read_bytes(), content)

    def test_unknown_multiline_hook_is_preserved_during_exact_legacy_migration(self):
        config = Path(self.env['KIMI_CODE_HOME']) / 'config.toml'
        legacy = ('[[hooks]]\nevent = "SessionStart"\n'
                  'command = \'node "$HOME/.config/ponytail/kimi-hook.js" SessionStart\'\n'
                  'timeout = 5\n\n')
        unknown = ('[[hooks]]\nevent = "UserPromptSubmit"\ncommand = \'\'\'printf personal\n'
                   + legacy + '\'\'\'\ntimeout = 6\n')
        config.write_text(legacy + unknown)
        report = self.install()
        hooks = tomllib.loads(config.read_text())['hooks']
        self.assertIn('归属不明', report)
        self.assertIn(unknown, config.read_text())
        self.assertEqual(sum(hook['command'] == 'node "$HOME/.config/ponytail/kimi-hook.js" SessionStart'
                             for hook in hooks), 0)
        self.install('--uninstall')
        self.assertEqual(config.read_text(), unknown)

    def test_ponytail_only_uninstall_preserves_unknown_hooks_inside_and_outside_managed_block(self):
        config = Path(self.env['KIMI_CODE_HOME']) / 'config.toml'
        event = 'UserPromptSubmit'
        outside = ('[[hooks]]\nevent = "' + event + '"\n'
                   'command = \'node "${KIMI_CODE_HOME:-$HOME/.kimi-code}/hooks/ponytail-hook.js" '
                   + event + '\'\ntimeout = 5\n\n')
        unknown = outside.replace('timeout = 5', 'timeout = 30')
        multiline = ('[[hooks]]\nevent = "UserPromptSubmit"\ncommand = \'\'\'printf personal\n'
                     + outside + '\'\'\'\ntimeout = 6\n\n')
        marker = '# <<< blue-whale-ai kimi hooks (managed by scripts/install-kimi-hooks.sh) <<<'
        config.write_text(outside + config.read_text().replace(marker, unknown + multiline + marker))
        self.assertIn('归属不明', self.install('--uninstall-ponytail'))
        remaining = config.read_bytes()
        self.assertIn(outside, config.read_text())
        self.assertIn(unknown, config.read_text())
        self.assertIn(multiline, config.read_text())
        hooks = tomllib.loads(config.read_text())['hooks']
        self.assertEqual(len(hooks), 20)
        self.assertEqual(sum('blue-whale-hook.sh' in hook['command'] for hook in hooks), 17)
        self.install('--uninstall-ponytail')
        self.assertEqual(config.read_bytes(), remaining)
        config.write_text(outside)
        self.install('--uninstall-ponytail')
        self.assertEqual(config.read_text(), outside)

    def test_ponytail_only_uninstall_rejects_invalid_configuration_before_removing_shim(self):
        config = Path(self.env['KIMI_CODE_HOME']) / 'config.toml'
        shim_dir = Path(self.env['KIMI_CODE_HOME']) / 'hooks'
        shims = {name: (shim_dir / name).read_bytes()
                 for name in ['blue-whale-hook.sh', 'ponytail-hook.js']}
        begin = '# >>> blue-whale-ai kimi hooks (managed by scripts/install-kimi-hooks.sh) >>>\n'
        end = '# <<< blue-whale-ai kimi hooks (managed by scripts/install-kimi-hooks.sh) <<<\n'
        for invalid in ['default_model = [', begin, end + begin, begin + end + begin + end]:
            with self.subTest(invalid=invalid):
                config.write_text(invalid)
                result = subprocess.run(['bash', str(self.root / 'scripts/install-kimi-hooks.sh'),
                                         '--uninstall-ponytail'], cwd=self.root, env=self.env,
                                        text=True, capture_output=True, timeout=30)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(config.read_text(), invalid)
                for name, content in shims.items():
                    self.assertEqual((shim_dir / name).read_bytes(), content)

    def test_unknown_legacy_variants_and_invalid_configuration_are_not_overwritten(self):
        config = Path(self.env['KIMI_CODE_HOME']) / 'config.toml'
        unknown = ('[[hooks]]\nevent = "SessionStart"\n'
                   'command = \'node "$HOME/.config/ponytail/kimi-hook.js" SessionStart\'\n'
                   'timeout = 30\n')
        config.write_text(unknown)
        self.assertIn('归属不明', self.install())
        self.assertIn(unknown, config.read_text())
        self.install('--uninstall')
        self.assertEqual(config.read_text(), unknown)
        for invalid in ['default_model = [',
                        '# >>> blue-whale-ai kimi hooks (managed by scripts/install-kimi-hooks.sh) >>>\n']:
            with self.subTest(invalid=invalid):
                config.write_text(invalid)
                for arguments in [[], ['--uninstall']]:
                    result = subprocess.run(['bash', str(self.root / 'scripts/install-kimi-hooks.sh'),
                                             *arguments], cwd=self.root, env=self.env,
                                            text=True, capture_output=True, timeout=30)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(config.read_text(), invalid)

    def test_contract_checker_accepts_exact_context_hooks_and_rejects_unsafe_shapes(self):
        config = self.base / 'contract.toml'
        valid = (self.root / '.kimi-code/hooks.toml').read_text()
        config.write_text(valid)

        def check():
            return subprocess.run([sys.executable, str(ROOT / 'scripts/check-hook-contracts.py'),
                                   '--kimi', str(config)], cwd=self.root, env=self.env,
                                  text=True, capture_output=True, timeout=10)

        result = check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        command = 'node "${KIMI_CODE_HOME:-$HOME/.kimi-code}/hooks/ponytail-hook.js" '
        variants = [
            {'event': 'PreToolUse', 'matcher': 'Grep|Glob', 'command': command + 'UserPromptSubmit', 'timeout': 5},
            {'event': 'PostToolUse', 'command': command + 'UserPromptSubmit', 'timeout': 5},
            {'event': 'SessionStart', 'command': command + 'UserPromptSubmit', 'timeout': 5},
            {'event': 'SessionStart', 'command': 'node "/unmanaged/ponytail-hook.js" SessionStart', 'timeout': 5},
            {'event': 'UserPromptSubmit', 'command': command + 'UserPromptSubmit && printf extra', 'timeout': 5},
            {'event': 'UserPromptSubmit', 'command': command + 'UserPromptSubmit', 'timeout': 30},
            {'event': 'UserPromptSubmit', 'matcher': '.*', 'command': command + 'UserPromptSubmit', 'timeout': 5},
        ]
        for variant in variants:
            with self.subTest(variant=variant):
                extra = '\n[[hooks]]\n' + ''.join(key + ' = ' + json.dumps(value) + '\n'
                                                  for key, value in variant.items())
                config.write_text(valid + extra)
                result = check()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Kimi CLI', result.stderr)

    def test_defaults_switch_off_invalid_arguments_and_one_shots_use_shared_policy(self):
        config = self.home / 'config/ponytail/config.json'
        config.parent.mkdir(parents=True)
        for mode in ['off', 'lite', 'full', 'ultra']:
            with self.subTest(default=mode):
                config.write_text(json.dumps({'defaultMode': mode, 'preserved': True}))
                self.assertEqual(self.run_hook('kimi', 'SessionStart'), '')
                output = self.run_hook('kimi', 'UserPromptSubmit', '普通开发请求')
                if mode == 'off':
                    self.assertEqual(output, '')
                else:
                    self.assert_mode(output, mode)
                self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail ultra'), 'ultra')
                for suffix in ['review', 'audit', 'debt', 'gain', 'help']:
                    self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail-' + suffix), 'ultra')
                    self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '继续实现'), 'ultra')
                for command in ['/skill:ponytail bogus', '/skill:ponytail full extra',
                                '/skill:ponytail default review', '添加 normal mode 按钮']:
                    self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', command), 'ultra')
                self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail'), 'ultra')
                for command in ['/skill:ponytail off', 'stop ponytail.', 'normal mode!']:
                    self.assertIn('PONYTAIL MODE OFF', self.run_hook('kimi', 'UserPromptSubmit', command))
                    self.assertEqual(self.run_hook('kimi', 'UserPromptSubmit', '普通开发请求'), '')
                    self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail'),
                                     'full' if mode == 'off' else mode)
                self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail ultra')
                self.assertEqual(json.loads(config.read_text())['defaultMode'], mode)
                self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail default lite')
                self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '当前档位'), 'ultra')
                self.assertEqual(json.loads(config.read_text()), {'defaultMode': 'lite', 'preserved': True})
                self.assertEqual(self.run_hook('kimi', 'SessionStart'), '')
                self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '新会话输入'), 'lite')
                self.env['PONYTAIL_DEFAULT_MODE'] = ' FuLL '
                self.run_hook('kimi', 'SessionStart')
                self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '环境默认值'), 'full')
                del self.env['PONYTAIL_DEFAULT_MODE']

    def test_clients_projects_linked_worktrees_and_unenabled_projects_are_isolated(self):
        other = self.install_project('other')
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'user.name=测试', '-c', 'user.email=test@example.invalid',
                        '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'],
                       cwd=self.root, check=True)
        linked = self.base / 'linked'
        subprocess.run(['git', 'worktree', 'add', '-qb', 'linked', str(linked)],
                       cwd=self.root, check=True, capture_output=True)
        self.env.update(COPILOT_PLUGIN_DATA=str(self.home / 'copilot'),
                        QODER_SESSION_ID='inherited', CURSOR_VERSION='inherited')
        for root in [self.root, other, linked]:
            self.assertEqual(self.run_hook('kimi', 'SessionStart', root=root), '')
            self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '开发请求', root=root), 'full')
        self.run_hook('claude', 'SessionStart')
        self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail ultra')
        self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail lite', root=linked)
        self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail off', root=other)
        self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '开发请求'), 'ultra')
        self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '开发请求', root=linked), 'lite')
        self.assertEqual(self.run_hook('kimi', 'UserPromptSubmit', '开发请求', root=other), '')
        self.assert_mode(self.run_hook('claude', 'SubagentStart'), 'full')
        self.assert_mode(self.run_hook('kimi', 'UserPromptSubmit', '载荷目录优先', cwd=str(linked)), 'lite')
        unenabled = self.base / 'unenabled'
        unenabled.mkdir()
        subprocess.run(['git', 'init', '-q', str(unenabled)], check=True)
        before = sorted(str(file.relative_to(self.home)) for file in self.home.rglob('*'))
        self.assertEqual(self.run_hook('kimi', 'SessionStart', root=unenabled), '')
        self.assertEqual(self.run_hook('kimi', 'UserPromptSubmit', '/skill:ponytail ultra', root=unenabled), '')
        after = sorted(str(file.relative_to(self.home)) for file in self.home.rglob('*'))
        self.assertEqual(after, before)
        self.assertEqual(sorted(file.name for file in unenabled.iterdir()), ['.git'])

    def test_migrated_real_user_configuration_injects_once_and_missing_skill_is_reported(self):
        config = Path(self.env['KIMI_CODE_HOME']) / 'config.toml'
        config.write_text(''.join('[[hooks]]\nevent = "' + event + '"\n'
                                 'command = \'node "$HOME/.config/ponytail/kimi-hook.js" ' + event + '\'\n'
                                 'timeout = 5\n\n' for event in ['SessionStart', 'UserPromptSubmit']))
        legacy = self.home / '.config/ponytail/kimi-hook.js'
        legacy.parent.mkdir(parents=True)
        legacy.write_text('process.stdout.write("legacy duplicate rules");')
        self.install()

        def all_hook_output(event, prompt=''):
            hooks = tomllib.loads(config.read_text())['hooks']
            output = ''
            for hook in hooks:
                if hook['event'] == event:
                    result = subprocess.run(hook['command'], shell=True, cwd=self.root, env=self.env,
                                            input=json.dumps({'hook_event_name': event, 'session_id': 'fixture',
                                                              'cwd': str(self.root), 'prompt': prompt}),
                                            text=True, capture_output=True, check=True, timeout=10)
                    output += result.stdout
            return output

        self.assertEqual(all_hook_output('SessionStart'), '')
        output = all_hook_output('UserPromptSubmit', '/skill:ponytail lite')
        self.assert_mode(output, 'lite')
        self.assertNotIn('legacy duplicate rules', output)
        (self.root / '.agents/skills/ponytail/SKILL.md').unlink()
        output = self.run_hook('kimi', 'UserPromptSubmit', '共享文件缺失')
        self.assertIn('共享技能缺失', output)
        self.assertIn('升级验收未通过', output)
        self.assertNotIn(BODY_PROBE, output)
        self.assertTrue(legacy.exists())

    def test_four_clients_share_rules_without_sharing_runtime_modes(self):
        market_root = ROOT / '.zcode/plugins'
        market = json.loads((market_root / 'marketplace.json').read_text())
        plugin = self.base / 'installed-zcode-plugin'
        shutil.copytree(market_root / market['plugins'][0]['source'], plugin)
        (self.root / '.zcode').mkdir()
        shutil.copyfile(ROOT / '.zcode/ponytail.json', self.root / '.zcode/ponytail.json')
        config = json.loads((plugin / 'hooks/hooks.json').read_text())

        def run(client, event, prompt=''):
            if client != 'zcode':
                return self.run_hook(client, event, prompt)
            handlers = [hook for entry in config['hooks'][event] for hook in entry['hooks']]
            self.assertEqual(len(handlers), 1)
            hook = handlers[0]
            self.assertEqual(hook['type'], 'process')
            args = [arg.replace('${ZCODE_PLUGIN_ROOT}', str(plugin)) for arg in hook['args']]
            result = subprocess.run([hook['command'], *args], cwd=self.root, env=self.env,
                                    input=json.dumps({'cwd': str(self.root), 'prompt': prompt}),
                                    text=True, capture_output=True, check=True, timeout=10)
            self.assertEqual(result.stderr, '')
            output = json.loads(result.stdout)
            specific = output.get('hookSpecificOutput', {})
            if specific:
                self.assertEqual(specific['hookEventName'], event)
            return specific.get('additionalContext', '')

        for client in ['codex', 'claude', 'kimi', 'zcode']:
            run(client, 'SessionStart')
        for client, command in [('codex', '$ponytail lite'), ('claude', '/ponytail ultra'),
                                ('kimi', '/skill:ponytail off'), ('zcode', '$ponytail full')]:
            output = run(client, 'UserPromptSubmit', command)
            if client == 'zcode':
                self.assert_mode(output, 'full')
        for client, mode in [('codex', 'lite'), ('claude', 'ultra')]:
            self.assert_mode(run(client, 'SubagentStart'), mode)
        self.assertIn('level: full', run('zcode', 'UserPromptSubmit', '$ponytail'))
        self.assertEqual(run('kimi', 'UserPromptSubmit', '继续开发'), '')
        self.assertIn('PONYTAIL MODE OFF', run('zcode', 'UserPromptSubmit', '$ponytail off'))
        self.assert_mode(run('kimi', 'UserPromptSubmit', '/skill:ponytail'), 'full')
        self.assertEqual(run('zcode', 'UserPromptSubmit', '继续开发'), '')
        self.assert_mode(run('codex', 'SubagentStart'), 'lite')
        self.assert_mode(run('claude', 'SubagentStart'), 'ultra')


if __name__ == '__main__':
    unittest.main()
