import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';


const edgeCss = readFileSync(fileURLToPath(new URL('./index.module.css', import.meta.url)), 'utf-8');

interface CssRule {
  selectors: string[];
  body: string;
}

function rulesOf(css: string): CssRule[] {
  const parsed: CssRule[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(stripped)) !== null) {
    parsed.push({
      selectors: match[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')),
      body: match[2],
    });
  }
  return parsed;
}

const rules = rulesOf(edgeCss);

const hoverFlowRules = rules.filter(
  r => r.selectors.includes('.edgeGroup:hover .glowPath') && /animation:\s*glowFlow/.test(r.body),
);

describe('IKR643 连线流动动效 CSS 源断言', () => {
  it('悬停流动规则唯一存在且使用光点头尾循环', () => {
    expect(hoverFlowRules).toHaveLength(1);
    expect(hoverFlowRules[0].body).toMatch(/animation:\s*glowFlow\s+2s\s+linear\s+infinite/);
  });

  it('选中相连与悬停共用同一条规则（一条规则、两个触发选择器）', () => {
    expect(hoverFlowRules[0].selectors).toContain('.edgeGroup.selectedConnected .glowPath');
    const selectedFlowRules = rules.filter(
      r => r.selectors.includes('.edgeGroup.selectedConnected .glowPath') && /animation:\s*glowFlow/.test(r.body),
    );
    expect(selectedFlowRules).toHaveLength(1);
    expect(selectedFlowRules[0]).toBe(hoverFlowRules[0]);
  });

  it('glowFlow 关键帧全文件只定义一份且周期为 2 秒', () => {
    expect(edgeCss.match(/@keyframes\s+glowFlow/g)).toHaveLength(1);
    expect(hoverFlowRules[0].body).toMatch(/2s/);
  });

  it('不使用跑动虚线，基础线与悬停都不设 dasharray 动画', () => {
    expect(edgeCss).not.toMatch(/stroke-dasharray:\s*10 10/);
    expect(edgeCss).not.toMatch(/@keyframes\s+dashFlow/);
  });

  it('减少动态效果时静态显示', () => {
    expect(edgeCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(edgeCss).toMatch(/animation:\s*none/);
  });

  it('剪刀可见性只由停稳出现类打开：悬停与选中相连都不显示剪刀', () => {
    const baseRules = rules.filter(r => r.selectors.includes('.deleteBtn'));
    expect(baseRules).toHaveLength(1);
    expect(baseRules[0].body).toMatch(/opacity:\s*0/);
    expect(baseRules[0].body).toMatch(/pointer-events:\s*none/);

    const visibleRules = rules.filter(r => r.selectors.includes('.deleteBtnVisible'));
    expect(visibleRules).toHaveLength(1);
    expect(visibleRules[0].body).toMatch(/opacity:\s*1/);
    expect(visibleRules[0].body).toMatch(/pointer-events:\s*all/);

    const hoverDeleteRules = rules.filter(r =>
      r.selectors.some(s => s.includes('deleteBtn') && s.includes(':hover') && !s.includes('.deleteBtn:hover')),
    );
    expect(hoverDeleteRules).toHaveLength(0);

    const selectedDeleteRules = rules.filter(r =>
      r.selectors.some(s => s.includes('selectedConnected') && s.includes('deleteBtn')),
    );
    expect(selectedDeleteRules).toHaveLength(0);
  });
});
