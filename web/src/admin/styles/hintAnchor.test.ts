import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';


const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

function startsWithHint(line: string): boolean {
  return /^\s*<Hint[\s>]/.test(line);
}

function inlineWithAbove(line: string): boolean {
  const t = line.trim();
  if (/\{' '\}$/.test(t)) return true;
  return /[([{,=>]\s*$/.test(t);
}

describe('★ 说明图标（Hint）必须贴着它说明的东西，不能悬空', () => {
  const offenders: string[] = [];
  let scanned = 0;

  for (const file of walk(ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    scanned += 1;
    for (let i = 0; i < lines.length; i += 1) {
      if (!startsWithHint(lines[i])) continue;
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === '') j -= 1;
      if (j < 0) continue;
      if (!inlineWithAbove(lines[j])) {
        const rel = file.slice(file.indexOf('src/admin/'));
        offenders.push(`${rel}:${i + 1}（上一行是 ${lines[j].trim().slice(0, 40)}）`);
      }
    }
  }

  it('扫到了文件（防遍历失效导致整条断言空转）', () => {
    expect(scanned).toBeGreaterThan(40);
  });

  it('没有单独成行的「?」', () => {
    expect(
      offenders,
      `这些 <Hint> 是独立节点、没有锚点 —— 要么写进它说明的那一行（标题 / 标签 / summary），` +
        `要么用 Field 的 info：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
