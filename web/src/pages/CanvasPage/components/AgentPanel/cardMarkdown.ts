/**
 * 提示词卡 → markdown（IKFLB9 定稿）：「打开查看」把卡渲染成文档，也按这份下载。（方案卡已退回原版，不再有 .md。）
 * 只是换个形状给人读，字段一个不加：卡上有的这里才有。
 */
import type { GenerationCardBlock } from '@/api/agentSessions';

function table(rows: [string, string | null | undefined][]): string {
  const kept = rows.filter((r): r is [string, string] => Boolean(r[1]));
  if (kept.length === 0) return '';
  return ['| 项 | 值 |', '| --- | --- |', ...kept.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
}

export function generationCardMarkdown(card: GenerationCardBlock): string {
  const parts = [
    `# ${card.shotTitle}`,
    table([
      ['媒介', card.targetMedia === 'video' ? '视频' : card.targetMedia === 'image' ? '图片' : null],
      ['模型', card.targetModel],
      ['画幅', card.aspectRatio],
      ['时长', card.durationSeconds !== undefined ? `${card.durationSeconds} 秒` : card.timeRange],
    ]),
    `## 提示词\n\n${card.prompt}`,
    card.assetRefItems?.length ? `## 参考素材\n\n${card.assetRefItems.map((r) => (r.marker ? `- ${r.marker}：${r.label}` : `- ${r.label}`)).join('\n')}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

/** 浏览器里把一段文字存成 .md。 */
export function downloadMarkdown(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
