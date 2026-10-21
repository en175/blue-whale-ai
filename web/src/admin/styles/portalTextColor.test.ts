import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';


const ADMIN_DIR = fileURLToPath(new URL('..', import.meta.url));

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

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBlockOf(css: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripComments(css).match(new RegExp(`(?:^|\\n)\\.${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

type PortalSource = 'createPortal' | 'dialog' | 'popover';

interface Portal {
  file: string;
  rootClass: string;
  cssPath: string;
}

const PORTAL_ROOT_PATTERNS: Record<PortalSource, RegExp> = {
  createPortal: /className=\{styles\.([A-Za-z0-9_]+)\}/,
  dialog: /<DialogPrimitive\.Overlay\b[^>]*className=\{styles\.([A-Za-z0-9_]+)\}/,
  popover: /<PopoverPrimitive\.Content\b[^>]*className=\{styles\.([A-Za-z0-9_]+)\}/,
};

function portalSourceOf(source: string): PortalSource | null {
  if (source.includes('createPortal(')) return 'createPortal';
  if (/<DialogPrimitive\.Overlay\b/.test(source)) return 'dialog';
  if (/<PopoverPrimitive\.Portal\b/.test(source)) return 'popover';
  return null;
}

function findPortals(): Portal[] {
  const portals: Portal[] = [];
  for (const tsx of collectTsx(ADMIN_DIR)) {
    const source = readFileSync(tsx, 'utf-8');
    const kind = portalSourceOf(source);
    if (kind === null) continue;

    const cssImport = source.match(/from\s+'(\.\/[^']+\.module\.css)'/);
    if (!cssImport) {
      throw new Error(`${relative(ADMIN_DIR, tsx)} 用了 portal 但没有引入 .module.css`);
    }
    const cssPath = join(tsx, '..', cssImport[1]);

    const scoped = kind === 'createPortal' ? source.slice(source.indexOf('createPortal(')) : source;
    const root = scoped.match(PORTAL_ROOT_PATTERNS[kind]);
    if (!root) {
      throw new Error(`${relative(ADMIN_DIR, tsx)} 的门户根元素上没有 styles.* 类名`);
    }
    portals.push({ file: relative(ADMIN_DIR, tsx), rootClass: root[1], cssPath });
  }
  return portals;
}

describe('管理端 portal 弹窗的文字色', () => {
  it('能扫到已知的两个门户（正则没失效）', () => {
    expect(findPortals().length).toBeGreaterThanOrEqual(2);
  });

  it.each(findPortals().map((p) => [p.file, p] as const))(
    '%s 的门户根声明了前景色',
    (_file, portal) => {
      const css = readFileSync(portal.cssPath, 'utf-8');
      const block = ruleBlockOf(css, portal.rootClass);
      expect(block, `门户根 .${portal.rootClass} 的规则块不存在`).not.toBeNull();
      expect(block).toContain('color: var(--admin-');
    },
  );
});
