#!/usr/bin/env python3
import argparse
import ast
from collections import Counter
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tokenize

SCRIPT_ROOT = Path(__file__).resolve().parent.parent
LEXERS = {
    '.java': 'java', '.sql': 'mysql', '.css': 'css', '.sh': 'bash',
    '.bash': 'bash', '.zsh': 'bash', '.proto': 'protobuf', '.prisma': 'typescript',
    '.html': 'html', '.htm': 'html', '.xml': 'xml', '.svg': 'xml',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.properties': 'jproperties',
    '.go': 'go', '.rs': 'rust', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.kt': 'kotlin',
}
JS_EXTENSIONS = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'}
DIRECTIVE = re.compile(
    r'^(?:@ts-(?:expect-error|ignore|check|nocheck)\b|eslint-(?:disable|enable)(?:-next-line|-line)?\b|'
    r'prettier-ignore\b|(?:istanbul|c8|v8) ignore\b|noinspection\b|noqa\b|type:\s*ignore\b|'
    r'(?:mypy|pyright|ruff|fmt|isort|shellcheck):?\s|go:|\+build\s|'
    r'source(?:Mapping)?URL=|@jsx(?:Runtime|ImportSource)?\s|@vitest-environment\b|[#@]__PURE__|'
    r'\+goose\s|(?:migrate|liquibase):)', re.I,
)
LICENSE = re.compile(r'^(?:SPDX-License-Identifier:|@license\b|Copyright\b|Licensed under\b|'
                     r'(?:MIT|Apache|BSD|Mozilla Public|GNU General Public) License\b)', re.I)


def git(*args):
    return subprocess.check_output(['git', *args]).decode('utf-8')


def runtime_python():
    common = subprocess.check_output(['git', '-C', str(SCRIPT_ROOT), 'rev-parse',
                                      '--git-common-dir']).decode().strip()
    directory = (SCRIPT_ROOT / common).resolve() / 'blue-whale' / 'comment-check-venv'
    return directory / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def install_runtime():
    python = runtime_python()
    subprocess.run([sys.executable, '-m', 'venv', str(python.parent.parent)], check=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '-r',
                    str(SCRIPT_ROOT / 'scripts/lib/code-comment-requirements.txt')], check=True)


def lexer_runtime():
    try:
        import pygments
        if pygments.__version__ == '2.19.2':
            return
    except ImportError:
        pass
    python = runtime_python()
    if python.exists() and python.absolute() != Path(sys.executable).absolute():
        os.execv(str(python), [str(python), str(Path(__file__).resolve()), *sys.argv[1:]])
    raise RuntimeError('缺少固定版本 Pygments；运行 python3 scripts/check-code-comments.py --install')


def language(path):
    suffix = Path(path).suffix.lower()
    if suffix in JS_EXTENSIONS:
        return 'javascript'
    if suffix == '.py':
        return 'python'
    if Path(path).name.startswith('Dockerfile'):
        return 'docker'
    if path.startswith('.githooks/') or re.match(r'^\.env(?:\.|$)', Path(path).name):
        return 'bash'
    return LEXERS.get(suffix)


def comments(path, source):
    selected = language(path)
    if selected == 'javascript':
        result = subprocess.run(['node', str(SCRIPT_ROOT / 'scripts/lib/code-comments-js.mjs')],
                                input=json.dumps({'filename': path, 'source': source}),
                                text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(path + ': TypeScript/JavaScript 注释解析失败；确认语法及 Node workspace 依赖')
        return json.loads(result.stdout)
    if selected == 'python':
        found = [{'start': token.start[0], 'end': token.end[0], 'text': token.string}
                 for token in tokenize.generate_tokens(io.StringIO(source).readline)
                 if token.type == tokenize.COMMENT]
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                body = node.body
                if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                    if isinstance(body[0].value.value, str):
                        found.append({'start': body[0].lineno, 'end': body[0].end_lineno,
                                      'text': ast.get_source_segment(source, body[0])})
        return found
    lexer_runtime()
    from pygments.lexers import get_lexer_by_name
    from pygments.token import Comment
    spans = []
    for offset, kind, value in get_lexer_by_name(selected).get_tokens_unprocessed(source):
        if kind not in Comment or kind in Comment.Preproc:
            continue
        previous = source[spans[-1][0]:spans[-1][1]] if spans else ''
        unfinished = (previous.startswith('/*') and not previous.endswith('*/')) or (
            previous.startswith('<!--') and not previous.endswith('-->'))
        if spans and spans[-1][1] == offset and unfinished:
            spans[-1] = (spans[-1][0], offset + len(value))
        else:
            spans.append((offset, offset + len(value)))
    return [{'start': source.count('\n', 0, start) + 1,
             'end': source.count('\n', 0, end - 1) + 1, 'text': source[start:end]}
            for start, end in spans]


def normalized(text):
    return '\n'.join(line.strip() for line in text.strip().splitlines())


def allowed(comment, path):
    text = comment['text'].strip()
    if comment['start'] == 1 and text.startswith('#!'):
        return True
    if language(path) == 'mysql' and text.startswith(('/*!', '/*+')):
        return True
    body = re.sub(r'^(?:/\*+|//|--|#|<!--)\s*', '', text)
    body = re.sub(r'(?:\*/|-->)$', '', body).strip()
    body = re.sub(r'^\*\s?', '', body, flags=re.M).strip()
    if language(path) == 'python' and comment['start'] <= 2:
        if re.match(r'^(?:-\*-\s*)?coding[:=]\s*[-\w.]+', body):
            return True
    if LICENSE.match(body):
        return True
    return '\n' not in body and DIRECTIVE.match(body) is not None


def changed_files(base):
    args = ['diff', '--name-status', '-z', '--find-renames', '--diff-filter=ACMR']
    args += [base, 'HEAD'] if base else ['--cached']
    fields = git(*args).split('\0')
    result = []
    index = 0
    while index < len(fields) and fields[index]:
        status, path = fields[index:index + 2]
        index += 2
        old_path = path if not status.startswith('A') else None
        if status.startswith(('R', 'C')):
            old_path, path = path, fields[index]
            index += 1
        if language(path):
            result.append((old_path, path))
    return result


def check(base):
    violations = []
    for old_path, path in changed_files(base):
        source = git('show', ('HEAD:' if base else ':') + path)
        old_source = git('show', (base or 'HEAD') + ':' + old_path) if old_path else ''
        original = Counter(normalized(item['text']) for item in comments(path, old_source))
        for item in comments(path, source):
            key = normalized(item['text'])
            if original[key]:
                original[key] -= 1
            elif not allowed(item, path):
                violations.append((path, item['start']))
    for path, line in violations:
        print(f'{path}:{line}: 禁止新增或改写普通代码注释，见 agent-rules/code-comments.md', file=sys.stderr)
    return 1 if violations else 0


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--staged', action='store_true')
    mode.add_argument('--base')
    mode.add_argument('--install', action='store_true')
    args = parser.parse_args()
    if args.install:
        install_runtime()
        return 0
    return check(args.base)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.CalledProcessError, SyntaxError, tokenize.TokenError) as error:
        print(f'代码注释检查失败，提交已阻断：{error}', file=sys.stderr)
        sys.exit(2)
