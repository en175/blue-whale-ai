
const STAGE_LABELS: Record<string, string> = {
  sample: '样片 480P',
  final: '成片 1080P',
};

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  processing: '生成中',
  succeeded: '已成功',
  failed: '已失败',
  cancelled: '已取消',
  checking: '状态核对中',
};

const CHARGE_LABELS: Record<string, string> = {
  held: '已预扣',
  settled: '已结算',
  released: '已退回',
};

export function stageBadgeLabel(stage: string | null | undefined): string | null {
  return stage && stage !== 'video' ? (STAGE_LABELS[stage] ?? null) : null;
}

export function jobStatusLabel(status: string | null | undefined): string {
  return STATUS_LABELS[status ?? ''] ?? String(status ?? '');
}

export function chargeLabel(
  chargeState: string | null | undefined,
  actualCredits: number | null | undefined,
): string | null {
  if (!chargeState && (actualCredits === null || actualCredits === undefined)) return null;
  const state = chargeState ? (CHARGE_LABELS[chargeState] ?? chargeState) : '';
  const credits = actualCredits != null ? ` · ${actualCredits} 积分` : '';
  return `${state}${credits}`.trim() || null;
}
