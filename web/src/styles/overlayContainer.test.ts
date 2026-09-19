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

/** 断言规则块不含给定硬编码色值黑名单（默认容器色值黑名单，可传家族扩展名单）。 */
const expectNoHardcoded = (block: string, colors: readonly string[] = HARDCODED_CONTAINER_COLORS) => {
  for (const hardcoded of colors) {
    expect(block).not.toContain(hardcoded);
  }
};

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
    expectNoHardcoded(block);
  });

  it('文本卡格式栏容器四件套引用令牌（圆角 8px → 浮条档 12px）', () => {
    const block = ruleBlockOf(textNodeCss, '.toolbar');
    expectOverlayContainer(block);
    expectNoHardcoded(block);
  });

  it('文本卡操作条 nodeBar 带容器底（与媒体卡工具栏同规格）', () => {
    const block = ruleBlockOf(textNodeCss, '.nodeBar');
    expectOverlayContainer(block);
    expectNoHardcoded(block);
  });

  it('商品卡顶栏 topBar 带容器底且不再撑满卡宽', () => {
    const block = ruleBlockOf(productNodeCss, '.topBar');
    expectOverlayContainer(block);
    expectNoHardcoded(block);
    expect(block).not.toContain('justify-content: space-between');
    expect(block).toContain('width: fit-content');
  });

  it('资产卡顶栏 topBar 带容器底：保留 !742 钉屏幕口径（两端分布 + 320 锚回），fit-content 其上收紧', () => {
    const block = ruleBlockOf(assetCardNodeCss, '.topBar');
    expectOverlayContainer(block);
    expectNoHardcoded(block);
    expect(block).toContain('justify-content: space-between');
    expect(block).toContain('min-width: 320px');
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
    // IKGZ86 审查修复锁定：字号/文字色/过渡沿用基线令牌写法，不得回退 #ddd/12px/0.12s 字面量
    expect(block).toContain('color: var(--color-text-primary)');
    expect(block).toContain('font-size: var(--font-size-sm)');
    expect(block).toContain('transition: background-color var(--transition-fast)');
    expect(block).not.toContain('#ddd');
    expect(block).not.toContain('12px');
    expect(block).not.toContain('0.12s');
  });

  it('条内按钮悬停统一 rgba(255, 255, 255, 0.08) 微亮（文本卡 toolBtn 告别 #444）', () => {
    expect(ruleBlockOf(textNodeCss, '.toolBtn:hover')).toContain('background-color: rgba(255, 255, 255, 0.08)');
    expect(ruleBlockOf(mediaNodeCss, '.toolBtn:hover')).toContain('background-color: rgba(255, 255, 255, 0.08)');
  });
});

/* ---- IKGZ8D 底部面板家族十成员断言 ----
   容器四件套必须引用令牌、规则体内不得残留硬编码容器背景/描边/阴影值。
   圆角口径：七个大容器（dialog/panel）锁 --radius-xl；擦除工具条与裁切面板是
   浮条形态，锁 --radius-lg；擦除发送条（999px）与扩图工具栏（24px）是验收拍板的
   胶囊/异形圆角，无对应令牌档，仅锁背景/描边/阴影三令牌。 */

/** 从 CSS 源提取顶层类选择器规则体（先剥离注释）；未找到时返回 null。
    ruleBlockOf 的 null 容错薄壳：入参不带点（8D 成员清单风格），解析语义与 ruleBlockOf 单一实现。 */
function ruleBodyOf(css: string, className: string): string | null {
  try {
    return ruleBlockOf(css, `.${className}`);
  } catch {
    return null;
  }
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

/* ---- IKGZ83 去字幕编辑态浮条家族（2 成员，24px 胶囊对齐 OutpaintDialog 统一后形态） ---- */

describe('IKGZ83 去字幕编辑态工具条/发送条（容器三令牌 + 24px 胶囊，无硬编码容器色值）', () => {
  const dialogCss = readFileSync(
    fileURLToPath(new URL('../pages/CanvasPage/components/VideoSubtitleEraseDialog/index.module.css', import.meta.url)),
    'utf-8',
  );

  it.each([
    ['源视频卡上方工具条', 'toolbar'],
    ['源视频卡下方发送条', 'sendBar'],
  ] as const)('%s 容器三件套引用令牌、圆角 24px 胶囊、无硬编码容器色值', (_name, container) => {
    const block = ruleBlockOf(dialogCss, `.${container}`);
    expect(block).toContain('background-color: var(--color-bg-overlay)');
    expect(block).toContain('border: 1px solid var(--color-border-overlay)');
    expect(block).toContain('border-radius: 24px');
    expect(block).toContain('box-shadow: var(--shadow-overlay)');
    expectNoHardcoded(block);
  });
});

/* ---- IKH28U 音视频分离编辑态浮条家族（2 成员，24px 胶囊对齐去字幕家族形态） ---- */

describe('IKH28U 音视频分离编辑态工具条/发送条（容器三令牌 + 24px 胶囊，无硬编码容器色值）', () => {
  const splitDialogCss = readFileSync(
    fileURLToPath(new URL('../pages/CanvasPage/components/VideoAudioSplitDialog/index.module.css', import.meta.url)),
    'utf-8',
  );

  it.each([
    ['源视频卡上方工具条', 'toolbar'],
    ['源视频卡下方发送条', 'sendBar'],
  ] as const)('%s 容器三件套引用令牌、圆角 24px 胶囊、无硬编码容器色值', (_name, container) => {
    const block = ruleBlockOf(splitDialogCss, `.${container}`);
    expect(block).toContain('background-color: var(--color-bg-overlay)');
    expect(block).toContain('border: 1px solid var(--color-border-overlay)');
    expect(block).toContain('border-radius: 24px');
    expect(block).toContain('box-shadow: var(--shadow-overlay)');
    expectNoHardcoded(block);
  });
});

/* ---- IKGZ8C 浮层菜单家族（7 成员，浮条档 12px） ---- */
describe('IKGZ8C 浮层菜单家族（ADR-0100：7 成员统一到浮层容器令牌）', () => {
  const memberCss = (component: string) =>
    readFileSync(
      fileURLToPath(new URL(`../pages/CanvasPage/components/${component}/index.module.css`, import.meta.url)),
      'utf-8',
    );
  // 菜单容器不允许的硬编码背景/描边色值（8B 基础上补本家族旧值 #262626/#363636）
  const menuHardcodedColors = [...HARDCODED_CONTAINER_COLORS, '#262626', '#363636'];

  it.each([
    ['高清▾ 下拉 qualityMenu', 'MediaNode', '.qualityMenu'],
    ['分离格式下拉 formMenu', 'VideoAudioSplitDialog', '.formatMenu'],
    ['右键菜单主层', 'CanvasContextMenu', '.menu'],
    ['右键菜单子层', 'CanvasContextMenu', '.subMenu'],
    ['标签操作层 chipMenu', 'TextNode', '.chipMenu'],
    ['连线类型菜单', 'ConnectTypeMenu', '.menu'],
    ['参考来源菜单 sourceMenu', 'RefSourceMenu', '.sourceMenu'],
  ] as const)('%s 容器四件套引用令牌、无硬编码容器色值', (_name, component, className) => {
    const block = ruleBlockOf(memberCss(component), className);
    expectOverlayContainer(block);
    expectNoHardcoded(block, menuHardcodedColors);
  });

  it('@菜单 panel/flyout 容器四件套引用令牌（圆角 14px → 浮条档 12px）', () => {
    const stripped = memberCss('AtMentionMenu').replace(/\/\*[\s\S]*?\*\//g, '');
    const match = stripped.match(/\.panel,\s*\.flyout\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const block = match![1];
    expectOverlayContainer(block);
    expectNoHardcoded(block, menuHardcodedColors);
  });

  it('@菜单搜索框对比度连带修正：#1f1f1f 调暗到 --color-bg-secondary（容器 #1e1e1e 后原值失去层级）', () => {
    const block = ruleBlockOf(memberCss('AtMentionMenu'), '.search');
    expect(block).toContain('background: var(--color-bg-secondary)');
    expect(block).not.toContain('#1f1f1f');
  });
});
