import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';


function ruleBodiesOf(css: string, selector: string): string[] {
  const bodies: string[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(stripped)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

describe('IKGB1X 附件操作条共享视觉定义源断言', () => {
  const sharedCss = readFileSync(fileURLToPath(new URL('./index.module.css', import.meta.url)), 'utf-8');

  it('.actionBar 三段布局行：flex 两端分布、不换行收缩', () => {
    const bodies = ruleBodiesOf(sharedCss, '.actionBar');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('display: flex');
    expect(bodies[0]).toContain('justify-content: space-between');
    expect(bodies[0]).toContain('flex-shrink: 0');
  });

  it('.pill 胶囊入口：999px 圆角、面板同源色板（#2a2a2a 底 / #333 边 / #888 字）', () => {
    const bodies = ruleBodiesOf(sharedCss, '.pill');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('border-radius: 999px');
    expect(bodies[0]).toContain('background-color: #2a2a2a');
    expect(bodies[0]).toContain('border: 1px solid #333');
    expect(bodies[0]).toContain('color: #888');
  });

  it('禁用态置灰由 aria-disabled 承载（保留悬停 title 说明原因）', () => {
    const bodies = ruleBodiesOf(sharedCss, ".pill[aria-disabled='true']");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('opacity: 0.45');
    expect(bodies[0]).toContain('cursor: not-allowed');
  });

  it('.picking 点选高亮：虚线强调边框（与 RefSourceMenu picking 同口径）', () => {
    const bodies = ruleBodiesOf(sharedCss, '.picking');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('dashed');
  });

  it('.trailing 右侧并入宿主操作：自动左外边距顶到行右', () => {
    const bodies = ruleBodiesOf(sharedCss, '.trailing');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('margin-left: auto');
  });

  it('源唯一性：三面板样式表不再保留第二份操作条 pill 定义', () => {
    for (const panel of ['../ImageDialog/index.module.css', '../BottomDialog/index.module.css', '../AudioDialog/index.module.css']) {
      const css = readFileSync(fileURLToPath(new URL(panel, import.meta.url)), 'utf-8');
      expect(ruleBodiesOf(css, '.pill')).toHaveLength(0);
      expect(ruleBodiesOf(css, '.actionBar')).toHaveLength(0);
      expect(ruleBodiesOf(css, '.picking')).toHaveLength(0);
    }
  });
});
