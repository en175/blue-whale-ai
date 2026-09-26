import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* ============================================================================
 * 管理端根必须声明前景色
 *
 * 全局 `body` 的文字色是**产品前台的深色主题**（白字），而管理端是浅色。
 * `.adminRoot` 不声明 `color` 时，任何**没有自己声明颜色**的元素都会继承到白字 ——
 * 白字压浅灰底，字还在、能选中、读屏也念，**就是看不见**。实际发生过两次：
 *   · 弹窗（经 createPortal 逃出本子树 → 另有 `portalTextColor.test.ts` 守着）；
 *   · 系统设置的「充值政策文案」里手写的 `<div>` / `<p>` 标签（本测试守着）。
 *
 * 套件组件各自声明了颜色，所以这个坑只在**手写元素**上暴露 —— 偏偏那正是最容易被漏掉的地方。
 * ==========================================================================*/

const adminCss = readFileSync(new URL('./admin.css', import.meta.url), 'utf8');

/** 取出**独立那条** `.adminRoot` 规则（不是 `:root, .adminRoot` 的 token 块）。 */
function adminRootBlock(css: string): string {
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.adminRoot\s*\{([^}]*)\}/g)].map(
    (m) => m[1],
  );
  // token 块里有 --admin-bg；这条找的是带 color-scheme 的那条
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
    // 白字在管理端只可能出现在**深色底**上（如主按钮）。写死的 white 一旦落在浅底上就是隐形字，
    // 所以这里断言：白色只允许作为**背景/描边**出现，不允许作为 color。
    const stripped = adminCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const whiteColorLines = stripped
      .split('\n')
      .filter((line) => /color:\s*(#fff|#ffffff|white|rgb\(255,\s*255,\s*255\))\b/i.test(line));
    expect(whiteColorLines, `这些行把文字设成纯白：\n${whiteColorLines.join('\n')}`).toEqual([]);
  });
});
