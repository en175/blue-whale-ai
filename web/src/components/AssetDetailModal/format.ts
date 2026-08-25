/* ============================================
 * AssetDetailModal 字段格式化纯函数（可单测）
 * ============================================ */

/** 资产来源可读映射；未知/空值显示原始值或「未知来源」 */
export function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'uploaded':
      return '用户上传';
    case 'generated':
      return 'AI 生成';
    default:
      return source || '未知来源';
  }
}

/** 时长（秒）→ mm:ss；null/NaN → — */
export function formatDuration(duration: number | null | undefined): string {
  if (duration == null || Number.isNaN(duration)) return '—';
  const total = Math.max(0, Math.floor(duration));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 字节 → 可读大小（B/KB/MB/GB）；null/NaN → — */
export function formatSize(size: number | null | undefined): string {
  if (size == null || Number.isNaN(size)) return '—';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 创建时间 ISO → 本地可读；空/无效 → — */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}
