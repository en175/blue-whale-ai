import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* IKGGC0 回归锁：选中节点相连的流动动效必须与悬停共用同一条 CSS 规则
   （一条规则、两个触发选择器），防止视觉定义漂移成两份；
   IKGUVG：剪刀出现时机不再由 CSS 悬停决定——悬停本身不显示剪刀，只有组件在
   指针停稳满 1 秒后追加的出现类才显示；选中相连同样不引入剪刀。
   渲染效果由人工浏览器回归验证。 */

const edgeCss = readFileSync(fileURLToPath(new URL('./index.module.css', import.meta.url)), 'utf-8');

interface CssRule {
  selectors: string[];
  body: string;
}

/** 解析全部顶层规则；选择器按精确匹配（逗号组拆开、空白归一），不误中更长选择器 */
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

/** 悬停流动规则：唯一一条含 .edgeGroup:hover .basePath 选择器的规则 */
const hoverFlowRules = rules.filter(r => r.selectors.includes('.edgeGroup:hover .basePath'));

describe('IKGGC0 连线流动动效 CSS 源断言', () => {
  it('悬停流动规则唯一存在且带虚线流动定义', () => {
    expect(hoverFlowRules).toHaveLength(1);
    expect(hoverFlowRules[0].body).toMatch(/stroke-dasharray:\s*10 10/);
    expect(hoverFlowRules[0].body).toMatch(/animation:\s*dashFlow\b/);
  });

  it('选中相连与悬停共用同一条规则（一条规则、两个触发选择器）', () => {
    expect(hoverFlowRules[0].selectors).toContain('.edgeGroup.selectedConnected .basePath');
    // 不存在选中态另起的第二条流动规则
    const selectedFlowRules = rules.filter(r => r.selectors.includes('.edgeGroup.selectedConnected .basePath'));
    expect(selectedFlowRules).toHaveLength(1);
    expect(selectedFlowRules[0]).toBe(hoverFlowRules[0]);
  });

  it('dashFlow 关键帧全文件只定义一份', () => {
    expect(edgeCss.match(/@keyframes\s+dashFlow/g)).toHaveLength(1);
  });

  it('剪刀可见性只由停稳出现类打开：悬停与选中相连都不显示剪刀', () => {
    // 默认隐藏（等待期间的光标与点击都不受影响）
    const baseRules = rules.filter(r => r.selectors.includes('.deleteBtn'));
    expect(baseRules).toHaveLength(1);
    expect(baseRules[0].body).toMatch(/opacity:\s*0/);
    expect(baseRules[0].body).toMatch(/pointer-events:\s*none/);

    // 唯一打开入口是组件按停稳状态追加的出现类
    const visibleRules = rules.filter(r => r.selectors.includes('.deleteBtnVisible'));
    expect(visibleRules).toHaveLength(1);
    expect(visibleRules[0].body).toMatch(/opacity:\s*1/);
    expect(visibleRules[0].body).toMatch(/pointer-events:\s*all/);

    // 悬停本身不再显示剪刀（旧形态 .edgeGroup:hover .deleteBtn 已移除）；
    // 剪刀自身的 :hover 只改填充色，不参与可见性
    const hoverDeleteRules = rules.filter(r =>
      r.selectors.some(s => s.includes('deleteBtn') && s.includes(':hover') && !s.includes('.deleteBtn:hover')),
    );
    expect(hoverDeleteRules).toHaveLength(0);

    // 选中相连同样不引入剪刀
    const selectedDeleteRules = rules.filter(r =>
      r.selectors.some(s => s.includes('selectedConnected') && s.includes('deleteBtn')),
    );
    expect(selectedDeleteRules).toHaveLength(0);
  });
});
