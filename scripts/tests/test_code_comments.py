from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / 'scripts/check-code-comments.py'


class CodeCommentsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        self.git('init', '-b', 'chore/comment-check')
        self.git('config', 'user.name', 'Comment Gate Test')
        self.git('config', 'user.email', 'comment-gate@example.invalid')
        self.write('README.md', 'baseline\n')
        self.git('add', '.')
        self.git('commit', '-m', 'docs: baseline')
        self.base = self.git('rev-parse', 'HEAD').strip()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, text=True,
                                       stderr=subprocess.PIPE)

    def write(self, path, source):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source)

    def run_check(self, *args):
        return subprocess.run([sys.executable, str(CHECKER), *(args or ('--staged',))],
                              cwd=self.repo, text=True, capture_output=True)

    def stage(self, path, source):
        self.write(path, source)
        self.git('add', '--', path)

    def assert_status(self, expected, *args):
        result = self.run_check(*args)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def test_rejects_ordinary_comments_in_each_language(self):
        cases = {
            'main.ts': '// explanation\nexport const value = 1;\n',
            'main.tsx': 'export const view = <div>{/* explanation */}</div>;\n',
            'main.mjs': '/** API explanation */\nexport const value = 1;\n',
            'Main.java': 'class Main { /* explanation */ int value = 1; }\n',
            'main.sql': 'SELECT 1; -- explanation\n',
            'main.css': 'body { /* explanation */ color: red; }\n',
            'main.sh': '#!/bin/sh\n# explanation\necho ok\n',
            'main.py': '# explanation\nvalue = 1\n',
            'main.proto': 'syntax = "proto3"; // explanation\n',
            'schema.prisma': '// explanation\nmodel Item {}\n',
            'main.html': '<div><!-- explanation --></div>\n',
            'main.xml': '<root><!-- explanation --></root>\n',
            'main.yaml': 'value: 1 # explanation\n',
            'main.toml': 'value = 1 # explanation\n',
            'main.properties': '# explanation\nvalue=1\n',
            'Dockerfile': 'FROM alpine\n# explanation\n',
        }
        for path, source in cases.items():
            with self.subTest(path=path):
                self.stage(path, source)
                self.assertIn(path + ':', self.assert_status(1).stderr)
                self.git('reset', '--', path)

    def test_allows_strings_regex_templates_jsx_and_heredoc_data(self):
        cases = {
            'main.tsx': 'const url = "https://example.invalid";\n'
                        'const regex = /https?:\\/\\//;\n'
                        'const text = `// literal\n/* literal */`;\n'
                        'export const view = <div>// literal # literal</div>;\n',
            'main.py': 'fixture = """# literal\n/* literal */"""\n',
            'Main.java': 'class Main { String text = """\n// literal\n"""; }\n',
            'main.sql': "SELECT '-- literal', '/* literal */';\n",
            'main.sh': "cat <<'EOF'\n# literal\n// literal\nEOF\n",
            'main.yaml': 'value: "# literal"\n',
            'docs/notes.md': '# heading\n```ts\n// example\n```\n',
        }
        for path, source in cases.items():
            self.stage(path, source)
        self.assert_status(0)

    def test_rejects_python_docstrings_but_keeps_assigned_fixtures(self):
        for source in ['"""module explanation"""\n',
                       'class Item:\n    """class explanation"""\n    pass\n',
                       'def run():\n    """function explanation"""\n    return 1\n']:
            with self.subTest(source=source):
                self.stage('main.py', source)
                self.assert_status(1)
        self.stage('main.py', 'text = """fixture"""\n')
        self.assert_status(0)

    def test_rejects_new_todo_comments(self):
        for path, prefix in [('main.py', '#'), ('main.ts', '//')]:
            for body in ['@todo ordinary explanation', 'TODO(ABCD): ordinary explanation',
                         'TODO(IKIZNS): ordinary explanation']:
                with self.subTest(path=path, body=body):
                    self.stage(path, f'{prefix} {body}\n')
                    self.assert_status(1)
            self.git('reset', '--', path)

    def test_preserves_old_todo_sentinels_without_allowing_new_ones(self):
        source = '// @todo sentinel\n// TODO(IKIZNS): sentinel\nexport const value = 1;\n'
        self.stage('main.ts', source)
        self.git('commit', '-m', 'test: old todo sentinels')
        self.stage('main.ts', source.replace('value = 1', 'value = 2'))
        self.assert_status(0)
        self.stage('main.ts', source + '// TODO(IKIZNS): sentinel\n')
        self.assert_status(1)

    def test_allows_tools_licenses_encoding_and_shebang(self):
        self.stage('main.ts', '// @ts-expect-error required type-error fixture\n'
                              'const value: number = "text";\n'
                              '/* eslint-disable no-console */\nconsole.log(value);\n'
                              '/* SPDX-License-Identifier: MIT */\n')
        self.stage('main.py', '#!/usr/bin/env python3\n# coding: utf-8\n'
                              'value = 1  # noqa: F841\n')
        self.stage('main.sh', '#!/bin/sh\n# shellcheck disable=SC2086\necho $value\n')
        self.stage('main.sql', '/*!40101 SET NAMES utf8mb4 */;\n')
        self.stage('main.test.tsx', '// @vitest-environment jsdom\nimport { it } from "vitest";\n')
        self.assert_status(0)

    def test_does_not_treat_bang_comments_or_attached_prose_as_tools(self):
        self.stage('main.ts', '/*! ordinary explanation */\nexport const value = 1;\n')
        self.assert_status(1)
        self.stage('main.ts', '/* eslint-disable no-console\nordinary explanation\n*/\n')
        self.assert_status(1)
        self.stage('main.sh', '# shellcheck disable=SC2086\n# ordinary explanation\n')
        self.assert_status(1)

    def test_checks_comments_inside_template_expressions(self):
        self.stage('main.ts', 'export const text = `value ${1 /* explanation */}`;\n')
        self.assert_status(1)

    def test_preserves_old_comments_on_code_change_and_allows_deletion(self):
        self.stage('main.ts', '// old explanation\nexport const value = 1;\n')
        self.git('commit', '-m', 'test: old comments')
        self.stage('main.ts', '// old explanation\nexport const value = 2;\n')
        self.assert_status(0)
        self.stage('main.ts', 'export const value = 2;\n')
        self.assert_status(0)

    def test_rejects_rewritten_or_duplicated_old_comments(self):
        self.stage('main.ts', '// old explanation\nexport const value = 1;\n')
        self.git('commit', '-m', 'test: old comments')
        self.stage('main.ts', '// new explanation\nexport const value = 1;\n')
        self.assert_status(1)
        self.stage('main.ts', '// old explanation\n// old explanation\nexport const value = 1;\n')
        self.assert_status(1)

    def test_rename_preserves_baseline_and_rejects_new_comment(self):
        self.stage('old file.ts', '// old explanation\nexport const value = 1;\n')
        self.git('commit', '-m', 'test: old comments')
        self.git('mv', 'old file.ts', '新文件.ts')
        self.assert_status(0)
        self.stage('新文件.ts', '// old explanation\n// new explanation\nexport const value = 1;\n')
        self.assert_status(1)

    def test_reads_index_instead_of_unstaged_worktree(self):
        self.stage('main.ts', 'export const value = 1;\n')
        self.write('main.ts', '// unstaged explanation\nexport const value = 1;\n')
        self.assert_status(0)
        self.git('add', 'main.ts')
        self.write('main.ts', 'export const value = 1;\n')
        self.assert_status(1)

    def test_base_mode_detects_committed_comment(self):
        self.stage('main.ts', '// explanation\nexport const value = 1;\n')
        self.git('commit', '-m', 'test: committed comment')
        self.assert_status(1, '--base', self.base)

    def test_invalid_source_fails_closed_without_printing_source(self):
        self.stage('main.ts', 'const privateValue = "unterminated-private-value\n')
        result = self.assert_status(2)
        self.assertNotIn('unterminated-private-value', result.stderr)

    def test_missing_parser_dependencies_fail_closed(self):
        self.write('isolated-tool/scripts/check-code-comments.py', CHECKER.read_text())
        self.write('isolated-tool/scripts/lib/code-comments-js.mjs',
                   (ROOT / 'scripts/lib/code-comments-js.mjs').read_text())
        isolated = self.repo / 'isolated-tool/scripts/check-code-comments.py'
        for path, source, reason in [
            ('main.ts', 'export const value = 1;\n', 'Node workspace'),
            ('Main.java', 'class Main {}\n', 'Pygments'),
        ]:
            with self.subTest(path=path):
                self.stage(path, source)
                result = subprocess.run([sys.executable, '-S', str(isolated), '--staged'],
                                        cwd=self.repo, text=True, capture_output=True)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertIn(reason, result.stderr)
                self.git('reset', '--', path)

    def test_real_precommit_rejects_comment_then_allows_code(self):
        self.git('config', 'core.hooksPath', str(ROOT / '.githooks'))
        self.stage('main.ts', '// explanation\nexport const value = 1;\n')
        rejected = subprocess.run(['git', 'commit', '-m', 'feat: comment check'],
                                  cwd=self.repo, text=True, capture_output=True)
        self.assertNotEqual(rejected.returncode, 0, rejected.stdout + rejected.stderr)
        self.assertIn('禁止新增', rejected.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.base)
        self.stage('main.ts', 'export const value = 1;\n')
        accepted = subprocess.run(['git', 'commit', '-m', 'feat: code without comments'],
                                  cwd=self.repo, text=True, capture_output=True)
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)


if __name__ == '__main__':
    unittest.main()
