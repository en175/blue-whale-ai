import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* 管理端「弹窗里的字看不见」回归锁。
 *
 * 病灶：`createPortal(..., document.body)` 把弹窗渲染到 `.adminRoot` **之外**，
 * 于是弹窗子树里那些**没有自己设颜色**的文字，继承到的是 `global.css` 给 body 的
 * 产品前台深色主题色 `--color-text-primary: #ffffff`——白字压白底。
 * 字还在、能选中、读屏也念，**就是看不见**，所以特别容易漏到线上。
 *
 * 这个坑踩过两次，且两次的修法互不覆盖：
 *   ① token：`--admin-*` 原先只挂 `.adminRoot`，弹窗取不到 → 编辑框透明底。
 *      修法是提到 `:root`。
 *   ② 颜色：颜色是**继承**来的，而 `:root` 上没有 `color`（挂上去会把前台也改色），
 *      提 token 治不了它。修法的唯一位置是**门户根**。
 *
 * 所以这里锁的不是某个具体颜色值，而是**门户根必须自己声明前景色**这一条结构约束：
 * 新加一个 portal 弹窗、或把门户根的 `color` 删掉，都会红。
 *
 * 只做静态检查（不渲染）：CSS 的值经 CSS Modules 编译后断言不到，而这里要守的
 * 恰恰是「源码里有没有这一行」。渲染效果由人工浏览器回归确认。
 */

const ADMIN_DIR = fileURLToPath(new URL('..', import.meta.url));

/** 递归收集目录下的所有 .tsx（跳过测试文件本身与测试用例）。 */
function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsx(full, out);
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

/** 剥离 CSS 注释：注释里写的 `color:` 不算数（本文件的注释里就有）。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 取指定类选择器的规则块声明文本；找不到时返回 null。 */
function ruleBlockOf(css: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 类选择器要带上点的 `.`——只匹配裸名字会把 `color:` 这类属性名当成选择器
  const match = stripComments(css).match(new RegExp(`(?:^|\\n)\\.${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

/** 一个 portal 弹窗的定位信息。 */
interface Portal {
  /** 相对 web/src/admin 的 tsx 路径，失败信息里用 */
  file: string;
  /** 门户根元素上的 CSS Modules 类名（`className={styles.overlay}` 里的 overlay） */
  rootClass: string;
  /** 该 tsx 引入的样式文件绝对路径 */
  cssPath: string;
}

/** 找出所有 portal 弹窗，并从 `createPortal(` 之后的第一段 JSX 里取门户根类名。 */
function findPortals(): Portal[] {
  const portals: Portal[] = [];
  for (const tsx of collectTsx(ADMIN_DIR)) {
    const source = readFileSync(tsx, 'utf-8');
    if (!source.includes('createPortal(')) continue;

    // 样式文件从 import 语句取，而不是猜 `index.module.css` —— 组件不一定叫 index
    const cssImport = source.match(/from\s+'(\.\/[^']+\.module\.css)'/);
    if (!cssImport) {
      throw new Error(`${relative(ADMIN_DIR, tsx)} 用了 createPortal 但没有引入 .module.css`);
    }
    const cssPath = join(tsx, '..', cssImport[1]);

    // 门户根 = `createPortal(` 之后的第一个 className={styles.X}。
    // 这两个 portal 的写法一致：最外层遮罩 → 内层面板。
    const afterPortal = source.slice(source.indexOf('createPortal('));
    const root = afterPortal.match(/className=\{styles\.([A-Za-z0-9_]+)\}/);
    if (!root) {
      throw new Error(`${relative(ADMIN_DIR, tsx)} 的门户根元素上没有 styles.* 类名`);
    }
    portals.push({ file: relative(ADMIN_DIR, tsx), rootClass: root[1], cssPath });
  }
  return portals;
}

describe('管理端 portal 弹窗的文字色', () => {
  // 兜底：新加 portal 弹窗必须一并遵守这条约束，所以这里**不写死名单**，
  // 而是断言「发现的每一个都合规」。数量断言只是防「正则失效、一个都没扫到」
  // 造成的假绿——真扫漏了比扫错更难发现。
  it('能扫到已知的两个门户（正则没失效）', () => {
    expect(findPortals().length).toBeGreaterThanOrEqual(2);
  });

  it.each(findPortals().map((p) => [p.file, p] as const))(
    '%s 的门户根声明了前景色',
    (_file, portal) => {
      const css = readFileSync(portal.cssPath, 'utf-8');
      const block = ruleBlockOf(css, portal.rootClass);
      expect(block, `门户根 .${portal.rootClass} 的规则块不存在`).not.toBeNull();
      // 必须是 token 而不是字面量：管理端只允许一套颜色口径
      expect(block).toContain('color: var(--admin-');
    },
  );
});
