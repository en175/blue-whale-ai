// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { PromptMaterial } from '@lib/contracts/prompt-preview';
import type { MediaRef } from '@lib/contracts/text-node-media';
import { applyMediaMentionState, createMediaMentionChip, renderPromptMentions } from './TextNode/promptMentions';
import chipStyles from './mediaChip.module.css';
import textNodeStyles from './TextNode/index.module.css';


const materials: Array<PromptMaterial & { url: string }> = [
  { assetId: '101', mediaType: 'image', url: 'https://example.com/a.png' },
];

const mediaRef = (nodeId: string, assetId: string): MediaRef => ({ nodeId, assetId, mediaType: 'image', name: '素材名', url: 'https://example.com/m.png' });
const allValid = () => true;

function mount(): HTMLElement {
  const editor = document.createElement('div');
  document.body.append(editor);
  return editor;
}

describe('IKG7NH 正文素材标签挂共享视觉类（渲染断言）', () => {
  it('media 标签 chip 挂共享胶囊类与文本卡可选中类，无内联视觉样式', () => {
    const editor = mount();
    renderPromptMentions(editor, '图片1', [], [], [{ start: 0, end: 3, nodeId: 'media-i1', assetId: '9001' }], [mediaRef('media-i1', '9001')], allValid);
    const chip = editor.querySelector<HTMLElement>('[data-media-node="media-i1"]')!;
    expect(chip.classList.contains(chipStyles.mediaChip)).toBe(true);
    expect(chip.classList.contains(textNodeStyles.mediaChipSelectable)).toBe(true);
    expect(chip.classList.contains(chipStyles.mediaChipInvalid)).toBe(false);
    expect(chip.getAttribute('style')).toBeNull();
    const media = chip.querySelector<HTMLImageElement>('[data-media-thumb] img')!;
    expect(media.classList.contains(chipStyles.mediaChipThumb)).toBe(true);
    expect(media.getAttribute('style')).toBeNull();
  });

  it('prompt 绑定标签（#N）chip 同样挂共享胶囊类与缩略图类', () => {
    const editor = mount();
    renderPromptMentions(editor, '[图]', [{ start: 0, end: 3, index: 1, assetId: '101' }], materials);
    const chip = editor.querySelector<HTMLElement>('[data-prompt-asset="101"]')!;
    expect(chip.classList.contains(chipStyles.mediaChip)).toBe(true);
    expect(chip.classList.contains(textNodeStyles.mediaChipSelectable)).toBe(true);
    expect(chip.getAttribute('style')).toBeNull();
    expect(chip.querySelector('img')!.classList.contains(chipStyles.mediaChipThumb)).toBe(true);
  });

  it('失效态用共享失效类派生，缩略图隐藏仍是行为控制', () => {
    const editor = mount();
    renderPromptMentions(editor, '图片1', [], [], [{ start: 0, end: 3, nodeId: 'media-i1', assetId: '9001' }], [mediaRef('media-i1', '9001')], allValid);
    applyMediaMentionState(editor, () => false);
    const chip = editor.querySelector<HTMLElement>('[data-media-node="media-i1"]')!;
    expect(chip.classList.contains(chipStyles.mediaChipInvalid)).toBe(true);
    expect(chip.classList.contains(chipStyles.mediaChip)).toBe(true);
    const thumb = chip.querySelector<HTMLElement>('[data-media-thumb]')!;
    expect(thumb.style.display).toBe('none');
    applyMediaMentionState(editor, allValid);
    expect(chip.classList.contains(chipStyles.mediaChipInvalid)).toBe(false);
    expect(thumb.style.display).toBe('');
  });

  it('createMediaMentionChip 产出的 chip 同样挂共享类（@菜单选中路径）', () => {
    const chip = createMediaMentionChip({ nodeId: 'media-i1', assetId: '9001', mediaType: 'image', name: 'a.png', url: 'https://example.com/m.png' }, '图片1', false);
    expect(chip.classList.contains(chipStyles.mediaChip)).toBe(true);
    expect(chip.classList.contains(textNodeStyles.mediaChipSelectable)).toBe(true);
  });
});
