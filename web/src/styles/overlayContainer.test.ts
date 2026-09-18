import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* IKGZ86 画布浮层容器视觉统一：测试锁基架。三个浮层容器令牌值已在 ADR-0100 定稿（不许改），
   这里锁全局令牌表（./variables.css）中的定义值，并锁圆角复用前提——不新增圆角令牌，
   大容器档 --radius-xl 与浮条档 --radius-lg 必须保持既有值。
   后续子票（IKGZ8B/8C/8D/8E）往此文件补 21 个成员断言（成员容器必须引用令牌、不得硬编码）。
   渲染效果由人工浏览器回归验证。 */

const variablesCss = readFileSync(fileURLToPath(new URL('./variables.css', import.meta.url)), 'utf-8');

/** 从 CSS 源提取指定自定义属性（--xxx）的值；先剥离注释再匹配，未定义时返回 null。 */
function customPropertyOf(css: string, name: string): string | null {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const match = stripped.match(new RegExp(`${name}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim() : null;
}

describe('IKGZ86 浮层容器令牌（ADR-0100 定稿值）', () => {
  it('容器背景 --color-bg-overlay 为 #1e1e1e', () => {
    expect(customPropertyOf(variablesCss, '--color-bg-overlay')).toBe('#1e1e1e');
  });

  it('容器描边 --color-border-overlay 为 #2c2c2c', () => {
    expect(customPropertyOf(variablesCss, '--color-border-overlay')).toBe('#2c2c2c');
  });

  it('容器阴影 --shadow-overlay 为 0 8px 32px rgba(0, 0, 0, 0.4)', () => {
    expect(customPropertyOf(variablesCss, '--shadow-overlay')).toBe('0 8px 32px rgba(0, 0, 0, 0.4)');
  });
});

describe('浮层容器圆角复用前提（不新增圆角令牌，锁既有档位）', () => {
  it('大容器档 --radius-xl 保持 16px', () => {
    expect(customPropertyOf(variablesCss, '--radius-xl')).toBe('16px');
  });

  it('浮条档 --radius-lg 保持 12px', () => {
    expect(customPropertyOf(variablesCss, '--radius-lg')).toBe('12px');
  });
});

/* ---- IKGZ8D 底部面板家族十成员断言 ----
   容器四件套必须引用令牌、规则体内不得残留硬编码容器背景/描边/阴影值。
   圆角口径：七个大容器（dialog/panel）锁 --radius-xl；擦除工具条与裁切面板是
   浮条形态，锁 --radius-lg；擦除发送条（999px）与扩图工具栏（24px）是验收拍板的
   胶囊/异形圆角，无对应令牌档，仅锁背景/描边/阴影三令牌。 */

/** 从 CSS 源提取顶层类选择器规则体（先剥离注释）；未找到时返回 null。 */
function ruleBodyOf(css: string, className: string): string | null {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const match = stripped.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

describe('IKGZ8D 底部面板家族十成员（容器四件套引用令牌、无硬编码容器色值）', () => {
  const componentsRoot = new URL('../pages/CanvasPage/components/', import.meta.url);

  /** 成员容器清单；radius 为 null 表示胶囊/异形圆角无令牌档，不锁圆角。 */
  const members: Array<{ component: string; container: string; radius: string | null }> = [
    { component: 'ImageDialog', container: 'dialog', radius: 'var(--radius-xl)' },
    { component: 'BottomDialog', container: 'dialog', radius: 'var(--radius-xl)' },
    { component: 'AudioDialog', container: 'dialog', radius: 'var(--radius-xl)' },
    { component: 'AgentPanel', container: 'panel', radius: 'var(--radius-xl)' },
    { component: 'MusicDialog', container: 'dialog', radius: 'var(--radius-xl)' },
    { component: 'TextGenDialog', container: 'dialog', radius: 'var(--radius-xl)' },
    { component: 'ImageEnhanceDialog', container: 'dialog', radius: 'var(--radius-xl)' },
    { component: 'ImageEraseDialog', container: 'toolbar', radius: 'var(--radius-lg)' },
    { component: 'ImageEraseDialog', container: 'sendBar', radius: null },
    { component: 'OutpaintDialog', container: 'toolbar', radius: null },
    { component: 'CropDialog', container: 'panel', radius: 'var(--radius-lg)' },
  ];

  for (const { component, container, radius } of members) {
    it(`${component} .${container} 容器四件套引用令牌、无硬编码容器色值`, () => {
      const css = readFileSync(
        fileURLToPath(new URL(`${component}/index.module.css`, componentsRoot)),
        'utf-8',
      );
      const body = ruleBodyOf(css, container);
      expect(body).not.toBeNull();
      expect(body).toContain('var(--color-bg-overlay)');
      expect(body).toContain('var(--color-border-overlay)');
      expect(body).toContain('var(--shadow-overlay)');
      if (radius !== null) {
        expect(body).toContain(`border-radius: ${radius}`);
      }
      expect(body).not.toMatch(/#1e1e1e|#2c2c2c/);
      expect(body).not.toContain('0 8px 32px');
    });
  }
});
