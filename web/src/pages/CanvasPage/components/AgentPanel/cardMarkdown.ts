/**
 * 方案卡 / 提示词卡 → markdown（IKFLB9 定稿）：「▤ .md」「打开查看」把卡渲染成文档，也按这份下载。
 * 只是换个形状给人读，字段一个不加：卡上有的这里才有。
 */
import type { GenerationCardBlock, RequirementUnderstanding } from '@/api/agentSessions';

function table(rows: [string, string | null | undefined][]): string {
  const kept = rows.filter((r): r is [string, string] => Boolean(r[1]));
  if (kept.length === 0) return '';
  return ['| 项 | 值 |', '| --- | --- |', ...kept.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
}

export function solutionStatusLabel(status: RequirementUnderstanding['status']): string {
  return status === 'awaiting_confirmation' ? '等你拍板' : status === 'accepted' ? '已确认' : '已作废';
}

export function solutionCardMarkdown(u: RequirementUnderstanding): string {
  const card = u.solution_card;
  if (!card) return `# 方案卡\n\n${u.proposed_summary}`;
  const route = card.execution_route;
  const spec = card.delivery_spec;
  const specParts = [spec?.aspect_ratio, spec?.duration_seconds !== undefined ? `${spec.duration_seconds} 秒` : undefined, spec?.resolution].filter(Boolean);
  const parts = [
    '# 方案卡',
    table([
      ['媒介', card.target_media === 'video' ? '视频' : '图片'],
      ['模型', route ? `${route.model_family}${route.model_version ? ` ${route.model_version}` : ''}` : null],
      ['参数', specParts.length ? specParts.join(' · ') : null],
      ['范围', card.scope?.kind === 'continuation' ? card.scope.label : null],
      ['状态', solutionStatusLabel(u.status)],
    ]),
    `## 目标\n\n${card.goal}`,
    card.direction ? `## 方向\n\n${card.direction}` : '',
    card.constraints?.length || card.asset_roles?.length
      ? `## 你要求的\n\n${[...(card.constraints ?? []), ...(card.asset_roles ?? []).map((r) => `素材：${r.role}`)].map((x) => `- ${x}`).join('\n')}`
      : '',
    `## 我替你定的\n\n${card.assumptions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
    card.next_steps ? `## 接下来怎么做\n\n${card.next_steps}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
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
    card.assetRefItems?.length ? `## 参考素材\n\n${card.assetRefItems.map((r) => `- ${r.label}`).join('\n')}` : '',
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
