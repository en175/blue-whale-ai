import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';


const editorCss = readFileSync(fileURLToPath(new URL('./index.module.css', import.meta.url)), 'utf-8');

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
    const globalUlBodies = ruleBodiesOf(editorCss, 'ul');
    const globalOlBodies = ruleBodiesOf(editorCss, 'ol');
    expect(globalUlBodies).toHaveLength(0);
    expect(globalOlBodies).toHaveLength(0);
  });
});
