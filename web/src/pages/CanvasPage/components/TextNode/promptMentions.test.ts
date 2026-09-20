// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { PromptMention, PromptMaterial } from '@lib/contracts/prompt-preview';
import { mediaAndPromptMentionsDisjoint, type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { applyMediaMentionState, createMediaMentionChip, readPromptMentions, renderPromptMentions } from './promptMentions';

/* IKFM3L 统一正文契约 v1：Markdown 源 + mention 区间 → DOM → Markdown 源 的往返保真
   IKFM3Q 正文媒体索引契约 v1：media 标签的编号/失效由身份与有效性派生，序列化写回派生文本 */

const materials: Array<PromptMaterial & { url: string }> = [
  { assetId: '101', mediaType: 'image', url: 'https://example.com/a.png' },
];

const mediaRef = (nodeId: string, assetId: string, mediaType: MediaRef['mediaType'], name = '素材名'): MediaRef => ({ nodeId, assetId, mediaType, name, url: 'https://example.com/m.png' });
const allValid = () => true;

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
    expect(readPromptMentions(editor)).toEqual({ text: '', mentions: [], mediaMentions: [], mediaRefs: [] });
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

describe('media 标签：编号与失效派生（IKFM3Q 契约 §2/§3）', () => {
  it('按正文首次出现顺序分类型编号，同身份复用', () => {
    const editor = mount();
    const md = '图片1与视频1再图片1然后图片2还有音频1';
    const mediaMentions: MediaMention[] = [
      { start: 0, end: 3, nodeId: 'media-i1', assetId: '9001' },
      { start: 4, end: 7, nodeId: 'media-v1', assetId: '9002' },
      { start: 8, end: 11, nodeId: 'media-i1', assetId: '9001' },
      { start: 13, end: 16, nodeId: 'media-i2', assetId: '9003' },
      { start: 18, end: 21, nodeId: 'media-a1', assetId: '9004' },
    ];
    const refs = [mediaRef('media-i1', '9001', 'image'), mediaRef('media-i2', '9003', 'image'), mediaRef('media-v1', '9002', 'video'), mediaRef('media-a1', '9004', 'audio')];
    renderPromptMentions(editor, md, [], [], mediaMentions, refs, allValid);
    const chipLabels = [...editor.querySelectorAll<HTMLElement>('[data-media-node]')].map(chip => `${chip.dataset.mediaNode}:${chip.dataset.mediaLabel}`);
    expect(chipLabels).toEqual(['media-i1:图片1', 'media-v1:视频1', 'media-i1:图片1', 'media-i2:图片2', 'media-a1:音频1']);
    const back = readPromptMentions(editor, allValid);
    expect(back.text).toBe(md);
    expect(back.mediaMentions).toEqual(mediaMentions);
    expect(back.mediaRefs).toEqual([refs[0], refs[2], refs[1], refs[3]]);
  });

  it('失效身份显示已失效：原素材名，有效编号紧凑重排并写回源', () => {
    const editor = mount();
    const md = '图片1被图片2夹图片3';
    const mediaMentions: MediaMention[] = [
      { start: 0, end: 3, nodeId: 'media-i1', assetId: '9001' },
      { start: 4, end: 7, nodeId: 'media-i2', assetId: '9002' },
      { start: 8, end: 11, nodeId: 'media-i3', assetId: '9003' },
    ];
    const refs = [mediaRef('media-i1', '9001', 'image'), mediaRef('media-i2', '9002', 'image', '猫咪原图'), mediaRef('media-i3', '9003', 'image')];
    const validity = (nodeId: string) => nodeId !== 'media-i2';
    renderPromptMentions(editor, md, [], [], mediaMentions, refs, validity);
    const chipLabels = [...editor.querySelectorAll<HTMLElement>('[data-media-node]')].map(chip => `${chip.dataset.mediaNode}:${chip.dataset.mediaLabel}:${chip.dataset.mediaInvalid ?? 'valid'}`);
    expect(chipLabels).toEqual(['media-i1:图片1:valid', 'media-i2:已失效：猫咪原图:1', 'media-i3:图片2:valid']);
    // 序列化写回派生文本：失效标签占位居长变化，区间仍锚定各自身份
    const back = readPromptMentions(editor, validity);
    expect(back.text).toBe('图片1被已失效：猫咪原图夹图片2');
    expect(back.text.slice(back.mediaMentions[1].start, back.mediaMentions[1].end)).toBe('已失效：猫咪原图');
    expect(back.mediaMentions.map(m => m.nodeId)).toEqual(['media-i1', 'media-i2', 'media-i3']);
  });

  it('源切片是显示缓存：陈旧编号在序列化时被规范化', () => {
    const editor = mount();
    // 磁盘上的切片写着旧编号 图片9，但派生编号是 图片1
    const md = '引用图片9结束';
    const mediaMentions: MediaMention[] = [{ start: 2, end: 5, nodeId: 'media-i1', assetId: '9001' }];
    renderPromptMentions(editor, md, [], [], mediaMentions, [mediaRef('media-i1', '9001', 'image')], allValid);
    expect(editor.querySelector<HTMLElement>('[data-media-node]')?.dataset.mediaLabel).toBe('图片1');
    const back = readPromptMentions(editor, allValid);
    expect(back.text).toBe('引用图片1结束');
    expect(back.mediaMentions).toEqual([{ start: 2, end: 5, nodeId: 'media-i1', assetId: '9001' }]);
  });

  it('顶层裸文本与 chip 合并为同一段落（空编辑器首次插入场景）', () => {
    const editor = mount();
    const identity = { nodeId: 'media-i1', assetId: '9001', mediaType: 'image' as const, name: '猫咪.png', url: 'https://example.com/m.png' };
    editor.append(document.createTextNode('参考 '));
    editor.append(createMediaMentionChip(identity, '图片1', false));
    const back = readPromptMentions(editor, allValid);
    expect(back.text).toBe('参考 图片1');
    expect(back.mediaMentions).toEqual([{ start: 3, end: 6, nodeId: 'media-i1', assetId: '9001' }]);
    expect(back.mediaRefs).toEqual([{ nodeId: 'media-i1', assetId: '9001', mediaType: 'image', name: '猫咪.png', url: 'https://example.com/m.png' }]);
    // 往返：单段落，chip 不被拆成独立块
    const replay = mount();
    renderPromptMentions(replay, back.text, [], [], back.mediaMentions, back.mediaRefs, allValid);
    expect(replay.querySelectorAll('p')).toHaveLength(1);
    expect(replay.querySelector('[data-media-node="media-i1"]')).not.toBeNull();
  });

  it('prompt 绑定标签与 media 标签混排互不干扰', () => {
    const editor = mount();
    const md = '素材#1和图片1';
    const mentions: PromptMention[] = [{ start: 0, end: 4, index: 1, assetId: '101' }];
    const mediaMentions: MediaMention[] = [{ start: 5, end: 8, nodeId: 'media-i1', assetId: '9001' }];
    renderPromptMentions(editor, md, mentions, materials, mediaMentions, [mediaRef('media-i1', '9001', 'image')], allValid);
    expect(editor.querySelector('[data-prompt-asset="101"]')).not.toBeNull();
    expect(editor.querySelector('[data-media-node="media-i1"]')).not.toBeNull();
    const back = readPromptMentions(editor, allValid);
    expect(back.text).toBe(md);
    expect(back.mentions).toEqual(mentions);
    expect(back.mediaMentions).toEqual(mediaMentions);
  });

  it('应用生成卡的同区间双数组：渲染去重，但编辑序列化必须保住镜像索引（IKH4EF）', () => {
    const editor = mount();
    // applyPreview（IKG6EK）把方案绑定原地派生成同区间的 mediaMentions，节点落库即带两套同区间标签
    const md = '[素材][素材]';
    const mentions: PromptMention[] = [
      { start: 0, end: 4, index: 1, assetId: '101' },
      { start: 4, end: 8, index: 1, assetId: '101' },
    ];
    const mediaMentions: MediaMention[] = [
      { start: 0, end: 4, nodeId: 'media-i1', assetId: '101' },
      { start: 4, end: 8, nodeId: 'media-i1', assetId: '101' },
    ];
    const refs = [mediaRef('media-i1', '101', 'image')];
    renderPromptMentions(editor, md, mentions, materials, mediaMentions, refs, allValid);
    // 渲染去重：每段只出一张 chip，且保留方案 #N 身份（IKG99G）
    expect(editor.querySelectorAll('[data-prompt-asset="101"]')).toHaveLength(2);
    expect(editor.querySelectorAll('[data-media-node="media-i1"]')).toHaveLength(0);
    // 序列化回写：镜像索引不得被清空（清空会连带删掉 textIndex 关系线，目标参考素材随之丢失）
    const back = readPromptMentions(editor, allValid);
    expect(back.text).toBe(md);
    expect(back.mentions).toEqual(mentions);
    expect(back.mediaMentions).toEqual(mediaMentions);
    expect(back.mediaRefs).toEqual(refs);
    expect(mediaAndPromptMentionsDisjoint(back.mediaMentions, back.mentions)).toBe(true);
  });

  it('在标签前插入文字：镜像区间跟随平移，不留旧区间（IKH4EF）', () => {
    const editor = mount();
    const md = '[素材]尾巴';
    const mentions: PromptMention[] = [{ start: 0, end: 4, index: 1, assetId: '101' }];
    const mediaMentions: MediaMention[] = [{ start: 0, end: 4, nodeId: 'media-i1', assetId: '101' }];
    renderPromptMentions(editor, md, mentions, materials, mediaMentions, [mediaRef('media-i1', '101', 'image')], allValid);
    // 模拟「打开卡片敲一次字」：在首段最前面插入一个字符
    const block = editor.querySelector('p')!;
    block.insertBefore(document.createTextNode('X'), block.firstChild);
    const back = readPromptMentions(editor, allValid);
    expect(back.text).toBe('X[素材]尾巴');
    expect(back.mentions).toEqual([{ start: 1, end: 5, index: 1, assetId: '101' }]);
    expect(back.mediaMentions).toEqual([{ start: 1, end: 5, nodeId: 'media-i1', assetId: '101' }]);
  });

  it('applyMediaMentionState 编辑中就地翻转失效态与编号', () => {
    const editor = mount();
    const md = '图片1与图片2';
    const mediaMentions: MediaMention[] = [
      { start: 0, end: 3, nodeId: 'media-i1', assetId: '9001' },
      { start: 4, end: 7, nodeId: 'media-i2', assetId: '9002' },
    ];
    const refs = [mediaRef('media-i1', '9001', 'image'), mediaRef('media-i2', '9002', 'image', '二号图')];
    renderPromptMentions(editor, md, [], [], mediaMentions, refs, allValid);
    // 连线被删：media-i1 失效，media-i2 重排为 图片1
    applyMediaMentionState(editor, nodeId => nodeId === 'media-i2');
    const first = editor.querySelector<HTMLElement>('[data-media-node="media-i1"]')!;
    const second = editor.querySelector<HTMLElement>('[data-media-node="media-i2"]')!;
    expect(first.dataset.mediaInvalid).toBe('1');
    expect(first.dataset.mediaLabel).toBe('已失效：素材名');
    expect(second.dataset.mediaLabel).toBe('图片1');
    expect(second.dataset.mediaInvalid).toBeUndefined();
    // 连线恢复：就地回到有效编号
    applyMediaMentionState(editor, allValid);
    expect(first.dataset.mediaLabel).toBe('图片1');
    expect(first.dataset.mediaInvalid).toBeUndefined();
    expect(second.dataset.mediaLabel).toBe('图片2');
  });
});
