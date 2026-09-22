import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* IKFZW7 列表标记回归锁：global.css 的 reset（ul, ol { list-style: none }）会抹掉
   execCommand 生成的真实 <ul>/<ol> 标记，.editor 内必须显式恢复 list-style，
   否则无序列表无圆点、有序列表无数字。渲染效果由人工浏览器回归验证。 */

const editorCss = readFileSync(fileURLToPath(new URL('./index.module.css', import.meta.url)), 'utf-8');

/** 取指定选择器（可含逗号组合）命中的规则体；选择器按精确匹配，避免误中更长选择器。 */
function ruleBodiesOf(css: string, selector: string): string[] {
  const bodies: string[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(stripped)) !== null) {
    const selectors = match[1].split(',').map(s => s.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

describe('IKFZW7 文本节点编辑器列表标记样式', () => {
  it('.editor ul 恢复无序列表圆点', () => {
    const bodies = ruleBodiesOf(editorCss, '.editor ul');
    expect(bodies.some(body => /list-style(-type)?\s*:\s*disc\b/.test(body))).toBe(true);
  });

  it('.editor ol 恢复有序列表数字', () => {
    const bodies = ruleBodiesOf(editorCss, '.editor ol');
    expect(bodies.some(body => /list-style(-type)?\s*:\s*decimal\b/.test(body))).toBe(true);
  });

  it('列表标记样式挂在 .editor 作用域内，不改全局 reset', () => {
    // 全局 reset 是全产品共享的，修复只能在组件作用域内覆盖
    const globalUlBodies = ruleBodiesOf(editorCss, 'ul');
    const globalOlBodies = ruleBodiesOf(editorCss, 'ol');
    expect(globalUlBodies).toHaveLength(0);
    expect(globalOlBodies).toHaveLength(0);
  });
});
