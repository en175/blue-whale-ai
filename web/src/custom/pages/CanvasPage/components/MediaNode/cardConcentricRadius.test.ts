import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';


const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'index.module.css'),
  'utf8',
);

const FULL_BLEED_CHILDREN = [
  '.mediaImage',
  '.mediaVideo',
  '.mediaVideoLayer',
  '.audioBox',
  '.genBox',
  '.missingBox',
  '.emptyShell',
];

const CONCENTRIC_RADIUS = 'border-radius: calc(var(--card-radius) - 1px)';

function* cssRules(): Generator<{ selector: string; body: string }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    yield { selector: match[1].trim(), body: match[2] };
  }
}

function ruleBody(selector: string): string {
  for (const rule of cssRules()) {
    if (rule.selector.split(',').map((s) => s.trim()).includes(selector)) {
      return rule.body;
    }
  }
  throw new Error(`CSS rule not found: ${selector}`);
}

describe('媒体卡圆角同心不变量', () => {
  it('卡片外壳经 --card-radius 变量声明圆角，音频卡只覆盖变量值', () => {
    const card = ruleBody('.contentCard');
    expect(card).toContain('--card-radius: 12px');
    expect(card).toContain('border-radius: var(--card-radius)');
    expect(card).not.toMatch(/border-radius:\s*\d+px/);

    const audioCard = ruleBody('.contentCard.audioCard');
    expect(audioCard).toContain('--card-radius: 16px');
    expect(audioCard).not.toMatch(/border-radius:/);
  });

  it('每个全幅内容子元素都挂在同心共享规则下，且为 calc(var(--card-radius) - 1px)', () => {
    for (const child of FULL_BLEED_CHILDREN) {
      expect(ruleBody(`.contentCard ${child}`)).toContain(CONCENTRIC_RADIUS);
    }
  });

  it('棋盘格垫底层同为同心圆角', () => {
    expect(ruleBody('.cutoutCheckerboard')).toContain(CONCENTRIC_RADIUS);
  });

  it('.contentCard 家族内不存在任何硬编码像素圆角', () => {
    const offenders = [...cssRules()]
      .filter((rule) => rule.selector.includes('.contentCard'))
      .map((rule) => ({ rule, radius: rule.body.match(/border-radius:\s*([^;]+);/) }))
      .filter(({ radius }) => radius !== null && /^\d+px$/.test(radius[1].trim()))
      .map(({ rule, radius }) => `${rule.selector} { border-radius: ${radius![1].trim()} }`);
    expect(offenders).toEqual([]);
  });
});
