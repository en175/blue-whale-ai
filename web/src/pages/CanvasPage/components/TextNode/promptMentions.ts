import type { PromptMention, PromptMaterial } from '@lib/contracts/prompt-preview';

/** Construct tags from trusted identity metadata; never inject source HTML. */
export function renderPromptMentions(editor: HTMLElement, text: string, mentions: PromptMention[], materials: Array<PromptMaterial & { url: string }>) {
  editor.replaceChildren();
  let cursor = 0;
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    editor.append(document.createTextNode(text.slice(cursor, mention.start)));
    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.dataset.promptAsset = mention.assetId;
    chip.dataset.promptIndex = String(mention.index);
    chip.dataset.promptLabel = text.slice(mention.start, mention.end);
    chip.title = `${chip.dataset.promptLabel}（素材 #${mention.index}）`;
    chip.setAttribute('aria-label', chip.title);
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 5px;border:1px solid #555;border-radius:5px;background:#303030;vertical-align:middle;user-select:all';
    const material = materials.find(item => item.assetId === mention.assetId);
    if (material?.mediaType === 'audio') {
      const icon = document.createElement('span');
      icon.textContent = '♫';
      icon.setAttribute('aria-hidden', 'true');
      icon.style.cssText = 'width:24px;text-align:center';
      chip.append(icon);
    } else if (material && /^https?:\/\//.test(material.url)) {
      const media = document.createElement(material.mediaType === 'image' ? 'img' : 'video');
      media.src = material.url;
      media.style.cssText = 'width:24px;height:24px;object-fit:cover;pointer-events:none';
      if (media instanceof HTMLImageElement) media.alt = '';
      else { media.preload = 'metadata'; media.muted = true; }
      chip.append(media);
    }
    chip.append(document.createTextNode(`#${mention.index}`));
    editor.append(chip);
    cursor = mention.end;
  }
  editor.append(document.createTextNode(text.slice(cursor)));
}

/** Serialize tag identities independently from their current DOM position. */
export function readPromptMentions(editor: HTMLElement): { text: string; mentions: PromptMention[] } {
  let text = '';
  const mentions: PromptMention[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { text += node.textContent ?? ''; return; }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.promptAsset) {
      const start = text.length;
      text += node.dataset.promptLabel ?? '';
      mentions.push({ start, end: text.length, assetId: node.dataset.promptAsset, index: Number(node.dataset.promptIndex) });
      return;
    }
    if (node.tagName === 'BR') { text += '\n'; return; }
    if ((node.tagName === 'DIV' || node.tagName === 'P') && text && !text.endsWith('\n')) text += '\n';
    node.childNodes.forEach(visit);
  };
  editor.childNodes.forEach(visit);
  return { text, mentions };
}
