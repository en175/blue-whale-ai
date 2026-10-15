import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';


describe('IKG7NH 共享视觉定义源断言', () => {
  const sharedCss = readFileSync(fileURLToPath(new URL('./mediaChip.module.css', import.meta.url)), 'utf-8');
  const promptMentionsSrc = readFileSync(fileURLToPath(new URL('./TextNode/promptMentions.ts', import.meta.url)), 'utf-8');
  const panelCss = readFileSync(fileURLToPath(new URL('./PromptRefEditor/index.module.css', import.meta.url)), 'utf-8');

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

  it('.mediaChip 胶囊保持生成面板原值：8px 圆角、12px 字号、20px 行高、白 8% 底', () => {
    const bodies = ruleBodiesOf(sharedCss, '.mediaChip');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('border-radius: 8px');
    expect(bodies[0]).toContain('font-size: 12px');
    expect(bodies[0]).toContain('line-height: 20px');
    expect(bodies[0]).toContain('background: rgba(255, 255, 255, 0.08)');
  });

  it('.mediaChipThumb 缩略图 18px、圆角 4px', () => {
    const bodies = ruleBodiesOf(sharedCss, '.mediaChipThumb');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('width: 18px');
    expect(bodies[0]).toContain('border-radius: 4px');
  });

  it('.mediaChipInvalid 失效态：淡红底 + 红实线框', () => {
    const bodies = ruleBodiesOf(sharedCss, '.mediaChipInvalid');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('background: rgba(248, 113, 113, 0.14)');
    expect(bodies[0]).toContain('border-color: rgba(248, 113, 113, 0.45)');
    expect(bodies[0]).not.toContain('dashed');
  });

  it('源唯一性：文本卡 chip 不再内联视觉样式', () => {
    expect(promptMentionsSrc).not.toContain('cssText');
    expect(promptMentionsSrc).not.toContain('#303030');
    expect(promptMentionsSrc).not.toContain('border-radius');
    expect(promptMentionsSrc).not.toContain('#555');
  });

  it('源唯一性：生成面板样式表不再保留第二份胶囊定义', () => {
    expect(panelCss).not.toContain('refChip');
  });

  it('文本卡差异类：整块选中留在 TextNode 侧；音频图标与缩略图包裹提升共享（IKGABW）', () => {
    const editorCss = readFileSync(fileURLToPath(new URL('./TextNode/index.module.css', import.meta.url)), 'utf-8');
    const selectable = ruleBodiesOf(editorCss, '.editor .mediaChipSelectable');
    expect(selectable).toHaveLength(1);
    expect(selectable[0]).toContain('user-select: all');
    const audioIcon = ruleBodiesOf(sharedCss, '.mediaChipAudioIcon');
    expect(audioIcon).toHaveLength(1);
    expect(audioIcon[0]).toContain('width: 18px');
    const thumbWrap = ruleBodiesOf(sharedCss, '.mediaChipThumbWrap');
    expect(thumbWrap).toHaveLength(1);
    expect(thumbWrap[0]).toContain('display: inline-flex');
    expect(thumbWrap[0]).toContain('align-items: center');
    expect(editorCss).not.toContain('.mediaChipAudioIcon');
    expect(editorCss).not.toContain('.mediaChipThumbWrap');
  });

  it('悬停预览浮层形态共享（IKGABW）：文本卡与生成面板共用 chipPreview 系列，仅此一份定义', () => {
    const preview = ruleBodiesOf(sharedCss, '.chipPreview');
    expect(preview).toHaveLength(1);
    expect(preview[0]).toContain('max-width: 280px');
    expect(preview[0]).toContain('pointer-events: none');
    const name = ruleBodiesOf(sharedCss, '.chipPreviewName');
    expect(name).toHaveLength(1);
    expect(name[0]).toContain('color: #aaa');
    const editorCss = readFileSync(fileURLToPath(new URL('./TextNode/index.module.css', import.meta.url)), 'utf-8');
    expect(ruleBodiesOf(editorCss, '.chipPreview')).toHaveLength(0);
    expect(ruleBodiesOf(editorCss, '.chipPreviewName')).toHaveLength(0);
  });
});
