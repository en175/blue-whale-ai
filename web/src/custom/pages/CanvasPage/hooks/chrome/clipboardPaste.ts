import { fetchRemoteMedia } from '../../media/fetchRemoteMedia';

export type ClipboardPastePayload =
  | { kind: 'image'; file: File }
  | { kind: 'text'; text: string };

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
  }
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) return { kind: 'text', text };
  } catch {
  }
  return null;
}

export async function copyImageToClipboard(url: string): Promise<void> {
  const res = await fetchRemoteMedia(url);
  if (!res.ok) throw new Error('读取图片失败');
  const blob = await res.blob();
  const type = blob.type.startsWith('image/') ? blob.type : 'image/png';
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
}
