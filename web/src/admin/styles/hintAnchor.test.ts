import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ============================================================================
 * 说明图标必须**贴着它说明的东西**
 *
 * `Hint` 渲染成一个行内 `?`。写在标题 / 标签行里，它就贴着那个标题；
 * **单独占一行**时，它是一枚悬在半空的问号 —— 读者不知道它在说哪一块。
 *
 * 这个坑在本仓实际发生过四次（定价 tab、会员折扣、限时活动、系统设置）：
 * 每次都是把一段"页面级说明"从蓝色 Alert 转成 `?` 时顺手留在了原位，
 * 于是标题下方多了一枚孤零零的图标。四次都靠人眼发现，所以补这条守卫。
 *
 * 判据（只看**结构**，不看内容）：`<Hint>` 独占一行，且它前面紧挨着的是
 * **另一个元素的收尾**（`/>` 或 `>`）—— 那说明它被当成了兄弟节点排在那儿，
 * 而不是跟在某段文字后面。写成 `{cond && <Hint>…</Hint>}` 或塞进
 * `<summary>文字 <Hint>…</Hint></summary>` 都不触发。
 * ==========================================================================*/

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

/** 该行是否「以 <Hint 独占开头」（前面只有空白）。 */
function startsWithHint(line: string): boolean {
  return /^\s*<Hint[\s>]/.test(line);
}

/** `Hint` 写在下一行、但**视觉上仍与上一行同行**的两种合法写法：见函数体注释。 */
function inlineWithAbove(line: string): boolean {
  const t = line.trim();
  // `文字{' '}` 结尾 —— JSX 里换行折叠成空格，图标仍贴着那段文字（本仓的常规写法）
  if (/\{' '\}$/.test(t)) return true;
  // `info: (` / `items: [` 结尾 —— 图标是某个 prop 的值，锚点是那个 prop 的标签
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
      // 往上找第一条非空行
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === '') j -= 1;
      if (j < 0) continue;
      // ⚠️ 判据是「独占一行」本身可疑，**不是**「上一行是不是某个元素的收尾」——
      //    后者会漏掉上一行是注释 / `)}` 的情况（限时活动页就是这么漏过去的）。
      //    只有明确写在表达式位置（`info: (` 之类）才放过。
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
