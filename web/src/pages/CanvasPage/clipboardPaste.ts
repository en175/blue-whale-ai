/* 系统剪贴板：复制图片原件 / 读取可粘贴的图或文本 */

export type ClipboardPastePayload =
  | { kind: 'image'; file: File }
  | { kind: 'text'; text: string };

/** 读取系统剪贴板：优先图片，其次纯文本；不可用时返回 null */
export async function readCanvasClipboard(): Promise<ClipboardPastePayload | null> {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] || 'png';
          return { kind: 'image', file: new File([blob], `粘贴.${ext}`, { type: imageType }) };
        }
      }
    }
  } catch {
    /* 权限拒绝或非安全上下文时回退读文本 */
  }
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) return { kind: 'text', text };
  } catch {
    /* 忽略 */
  }
  return null;
}

/** 把图片原件写入系统剪贴板，供外部应用粘贴 */
export async function copyImageToClipboard(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('读取图片失败');
  const blob = await res.blob();
  const type = blob.type.startsWith('image/') ? blob.type : 'image/png';
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
}
