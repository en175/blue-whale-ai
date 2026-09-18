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
