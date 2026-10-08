import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';


const adminCss = readFileSync(new URL('./admin.css', import.meta.url), 'utf8');

function adminRootBlock(css: string): string {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.adminRoot\s*\{([^}]*)\}/g)].map(
    (m) => m[1],
  );
  const m = blocks.find((b) => /color-scheme/.test(b));
  expect(m, 'admin.css 里找不到带 color-scheme 的 .adminRoot 规则').not.toBeUndefined();
  return m!;
}

describe('★ 管理端根声明前景色（否则手写元素继承到前台的白色）', () => {
  it('`.adminRoot` 有 color: var(--admin-text)', () => {
    expect(adminRootBlock(adminCss)).toMatch(/color:\s*var\(--admin-text\)/);
  });

  it('`.adminRoot` 仍带 color-scheme: light（原生控件不能跟着系统变暗）', () => {
    expect(adminRootBlock(adminCss)).toMatch(/color-scheme:\s*light/);
  });

  it('管理端 CSS 里没有写死的白色文字', () => {
    const stripped = adminCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const whiteColorLines = stripped
      .split('\n')
      .filter((line) => /color:\s*(#fff|#ffffff|white|rgb\(255,\s*255,\s*255\))\b/i.test(line));
    expect(whiteColorLines, `这些行把文字设成纯白：\n${whiteColorLines.join('\n')}`).toEqual([]);
  });
});
