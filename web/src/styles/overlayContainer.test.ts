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

/* ---- IKGZ8B 卡悬浮工具条家族（5 成员，浮条档 12px） ---- */

/** 从 CSS 源剥离注释后提取指定类选择器（如 `.toolbar`）的规则块声明；未找到时抛错。 */
function ruleBlockOf(css: string, className: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripped.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`CSS 规则块未找到: ${className}`);
  return match[1];
}

/** 成员容器四件套必须全引用令牌（浮条档 --radius-lg）。 */
function expectOverlayContainer(block: string) {
  expect(block).toContain('background-color: var(--color-bg-overlay)');
  expect(block).toContain('border: 1px solid var(--color-border-overlay)');
  expect(block).toContain('border-radius: var(--radius-lg)');
  expect(block).toContain('box-shadow: var(--shadow-overlay)');
}

/** 容器四件套位置不允许的硬编码背景/描边色值与胶囊残迹。 */
const HARDCODED_CONTAINER_COLORS = ['#2a2a2a', '#3a3a3a', '#333', 'rgba(24, 24, 24'];

describe('IKGZ8B 卡悬浮工具条家族（ADR-0100：5 成员统一到浮层容器令牌）', () => {
  const memberCss = (component: string) =>
    readFileSync(
      fileURLToPath(new URL(`../pages/CanvasPage/components/${component}/index.module.css`, import.meta.url)),
      'utf-8',
    );
  const mediaNodeCss = memberCss('MediaNode');
  const textNodeCss = memberCss('TextNode');
  const assetCardNodeCss = memberCss('AssetCardNode');
  const productNodeCss = memberCss('ProductNode');

  it('媒体卡工具栏容器四件套引用令牌，半透明底退役', () => {
    const block = ruleBlockOf(mediaNodeCss, '.toolbar');
    expectOverlayContainer(block);
    for (const hardcoded of HARDCODED_CONTAINER_COLORS) {
      expect(block).not.toContain(hardcoded);
    }
  });

  it('文本卡格式栏容器四件套引用令牌（圆角 8px → 浮条档 12px）', () => {
    const block = ruleBlockOf(textNodeCss, '.toolbar');
    expectOverlayContainer(block);
    for (const hardcoded of HARDCODED_CONTAINER_COLORS) {
      expect(block).not.toContain(hardcoded);
    }
  });

  it('文本卡操作条 nodeBar 带容器底（与媒体卡工具栏同规格）', () => {
    const block = ruleBlockOf(textNodeCss, '.nodeBar');
    expectOverlayContainer(block);
    for (const hardcoded of HARDCODED_CONTAINER_COLORS) {
      expect(block).not.toContain(hardcoded);
    }
  });

  it.each([
    ['资产卡顶栏', assetCardNodeCss],
    ['商品卡顶栏', productNodeCss],
  ] as const)('%s topBar 带容器底且不再撑满卡宽', (_name, css) => {
    const block = ruleBlockOf(css, '.topBar');
    expectOverlayContainer(block);
    for (const hardcoded of HARDCODED_CONTAINER_COLORS) {
      expect(block).not.toContain(hardcoded);
    }
    expect(block).not.toContain('justify-content: space-between');
    expect(block).toContain('width: fit-content');
  });

  it.each([
    ['文本卡', textNodeCss],
    ['资产卡', assetCardNodeCss],
    ['商品卡', productNodeCss],
  ] as const)('%s「添加到对话」按钮胶囊退役：透明底、悬停微亮、无胶囊边框', (_name, css) => {
    const block = ruleBlockOf(css, '.addToChatBtn');
    expect(block).toContain('background: transparent');
    expect(block).toContain('border: none');
    expect(block).not.toContain('999px');
    expect(block).not.toContain('#2a2a2a');
    expect(ruleBlockOf(css, '.addToChatBtn:hover')).toContain('background-color: rgba(255, 255, 255, 0.08)');
  });

  it('条内按钮悬停统一 rgba(255, 255, 255, 0.08) 微亮（文本卡 toolBtn 告别 #444）', () => {
    expect(ruleBlockOf(textNodeCss, '.toolBtn:hover')).toContain('background-color: rgba(255, 255, 255, 0.08)');
    expect(ruleBlockOf(mediaNodeCss, '.toolBtn:hover')).toContain('background-color: rgba(255, 255, 255, 0.08)');
  });
});
