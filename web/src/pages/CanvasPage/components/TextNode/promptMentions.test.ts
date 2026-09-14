// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { PromptMention, PromptMaterial } from '../../../../../../packages/contracts/src/prompt-preview';
import { readPromptMentions, renderPromptMentions } from './promptMentions';

/* IKFM3L 统一正文契约 v1：Markdown 源 + mention 区间 → DOM → Markdown 源 的往返保真 */

const materials: Array<PromptMaterial & { url: string }> = [
  { assetId: '101', mediaType: 'image', url: 'https://example.com/a.png' },
];

function mount(): HTMLElement {
  const editor = document.createElement('div');
  document.body.append(editor);
  return editor;
}

describe('renderPromptMentions + readPromptMentions 往返', () => {
  it('纯格式 Markdown 渲染并读回不变', () => {
    const editor = mount();
    const md = '# 标题\n\n正文 **粗** *斜*\n\n- 项一\n- 项二\n\n1. 一\n2. 二\n\n---\n\n尾段';
    renderPromptMentions(editor, md, [], []);
    expect(readPromptMentions(editor).text).toBe(md);
  });

  it('chip 在段落正文中：区间锚定 Markdown 源', () => {
    const editor = mount();
    const md = '开头[图]结尾';
    const mentions: PromptMention[] = [{ start: 2, end: 5, index: 1, assetId: '101' }];
    renderPromptMentions(editor, md, mentions, materials);
    const back = readPromptMentions(editor);
    expect(back.text).toBe(md);
    expect(back.mentions).toEqual(mentions);
    expect(editor.querySelector<HTMLElement>('[data-prompt-asset="101"]')?.dataset.promptLabel).toBe('[图]');
  });

  it('chip 处于粗体内部：格式与区间都往返保真', () => {
    const editor = mount();
    const md = '**粗[图]粗**';
    const mentions: PromptMention[] = [{ start: 2, end: 5, index: 1, assetId: '101' }];
    renderPromptMentions(editor, md, mentions, materials);
    expect(editor.querySelector('strong')).not.toBeNull();
    const back = readPromptMentions(editor);
    expect(back.text).toBe(md);
    expect(back.mentions).toEqual(mentions);
  });

  it('chip 在列表项与标题内往返', () => {
    const editor = mount();
    const md = '# 题[图]\n\n- 项[图]目';
    const mentions: PromptMention[] = [
      { start: 3, end: 6, index: 1, assetId: '101' },
      { start: 12, end: 15, index: 1, assetId: '101' },
    ];
    renderPromptMentions(editor, md, mentions, materials);
    const back = readPromptMentions(editor);
    expect(back.text).toBe(md);
    expect(back.mentions).toEqual(mentions);
  });

  it('execCommand 产物 DOM（h1/p/ul/ol/li/b/br/hr）序列化为 Markdown 源', () => {
    const editor = mount();
    editor.innerHTML = '<h1>标题</h1><p>正文<b>粗</b><br>换行</p><ul><li>项一</li></ul><ol><li>第一</li></ol><hr><div>尾段</div>';
    const back = readPromptMentions(editor);
    expect(back.text).toBe('# 标题\n\n正文**粗**\n换行\n\n- 项一\n\n1. 第一\n\n---\n\n尾段');
  });

  it('空编辑器产出空正文', () => {
    const editor = mount();
    expect(readPromptMentions(editor)).toEqual({ text: '', mentions: [] });
  });
});

describe('区间锚定规范化后的最终字符串（Spec 审查修复）', () => {
  it('首块为空段时 chip 区间不因 trim 偏移', () => {
    const editor = mount();
    editor.innerHTML = '<p><br></p><p>前<span contenteditable="false" data-prompt-asset="101" data-prompt-index="1" data-prompt-label="[图]">素材#1</span>后</p>';
    const back = readPromptMentions(editor);
    expect(back.text).toBe('前[图]后');
    expect(back.mentions).toEqual([{ start: 1, end: 4, index: 1, assetId: '101' }]);
    expect(back.text.slice(back.mentions[0].start, back.mentions[0].end)).toBe('[图]');
  });

  it('块尾 BR 产生多余换行折叠后区间仍锚定 label', () => {
    const editor = mount();
    editor.innerHTML = '<p>甲</p><p>乙<br><br><span contenteditable="false" data-prompt-asset="101" data-prompt-index="1" data-prompt-label="素材#1">素材#1</span></p>';
    const back = readPromptMentions(editor);
    expect(back.text).toContain('素材#1');
    const mention = back.mentions[0];
    expect(back.text.slice(mention.start, mention.end)).toBe('素材#1');
  });
});
