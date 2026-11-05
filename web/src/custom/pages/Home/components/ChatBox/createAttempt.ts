import { newIdempotencyKey } from '@/shared/api/idempotencyKey';
import { isApiError } from '@/shared/api/http';
import { fetchProjectListQuery, type ProjectRecord } from '@/custom/api/projects';

export const CREATE_ATTEMPT_STORAGE_KEY = 'bw:home:create-attempt';
export const CREATE_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 1000;
const AMBIGUOUS_STATUSES = new Set([0, 408, 502, 503, 504]);

export const CHECK_HINT = '创建结果未确认，请核对原请求';
export const CHECKING_HINT = '正在核对创建结果…';
export const CHECKED_ABSENT_HINT = '已确认未创建，可以重新发送';
export const CHECKED_CREATED_HINT = '已创建项目，正在打开原项目…';
export const CHECKED_UNREACHABLE_HINT = '暂时无法核对创建结果，请稍后点「核对结果」重试';

export interface CreateAttempt {
  id: string;
  name: string;
  userId: number;
  startedAt: number;
  unsure: boolean;
  absent: boolean;
  state: unknown;
}

export function newCreateAttempt(userId: number, name: string, state: unknown): CreateAttempt {
  return {
    id: newIdempotencyKey(),
    name,
    userId,
    startedAt: Date.now(),
    unsure: false,
    absent: false,
    state,
  };
}

export function isAmbiguousCreateError(error: unknown): boolean {
  if (isApiError(error)) return AMBIGUOUS_STATUSES.has(error.status);
  return !(error instanceof Error);
}

function parseAttempt(value: string): CreateAttempt | null {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;
  if (typeof record.name !== 'string') return null;
  if (typeof record.userId !== 'number') return null;
  if (typeof record.startedAt !== 'number') return null;
  if (typeof record.unsure !== 'boolean') return null;
  if (typeof record.absent !== 'boolean') return null;
  return {
    id: record.id,
    name: record.name,
    userId: record.userId,
    startedAt: record.startedAt,
    unsure: record.unsure,
    absent: record.absent,
    state: record.state ?? null,
  };
}

export function readCreateAttempt(userId: number, now = Date.now()): CreateAttempt | null {
  let value: string | null = null;
  try {
    value = sessionStorage.getItem(CREATE_ATTEMPT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!value) return null;
  const attempt = parseAttempt(value);
  if (!attempt || attempt.userId !== userId || now - attempt.startedAt > CREATE_ATTEMPT_TTL_MS) {
    clearCreateAttempt();
    return null;
  }
  return attempt;
}

export function writeCreateAttempt(attempt: CreateAttempt): void {
  try {
    sessionStorage.setItem(CREATE_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    return;
  }
}

export function clearCreateAttempt(): void {
  try {
    sessionStorage.removeItem(CREATE_ATTEMPT_STORAGE_KEY);
  } catch {
    return;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createdAtOf(record: ProjectRecord): number {
  const ts = Date.parse(record.created_at);
  return Number.isFinite(ts) ? ts : 0;
}

export function matchCreatedProject(
  records: ProjectRecord[],
  attempt: CreateAttempt,
): ProjectRecord | null {
  const fresh = records.filter(
    (record) => createdAtOf(record) >= attempt.startedAt - CLOCK_SKEW_MS,
  );
  const exact = fresh
    .filter((record) => record.name === attempt.name)
    .sort((a, b) => createdAtOf(b) - createdAtOf(a));
  if (exact.length > 0) return exact[0];
  const suffixed = new RegExp(`^${escapeRegExp(attempt.name)} \\((\\d+)\\)$`);
  const renamed = fresh
    .filter((record) => suffixed.test(record.name))
    .sort((a, b) => createdAtOf(a) - createdAtOf(b));
  return renamed[0] ?? null;
}

export const LATEST_ATTEMPT_KEY = 'bw:home:latest-create-attempt';
const LATEST_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export function writeLatestAttempt(attempt: CreateAttempt): void {
  try {
    sessionStorage.setItem(LATEST_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    return;
  }
}

export function readLatestAttempt(
  userId: number,
  now = Date.now(),
): CreateAttempt | null {
  let value: string | null = null;
  try {
    value = sessionStorage.getItem(LATEST_ATTEMPT_KEY);
  } catch {
    return null;
  }
  if (!value) return null;
  const attempt = parseAttempt(value);
  if (!attempt) return null;
  if (attempt.userId !== userId) return null;
  if (now - attempt.startedAt > LATEST_ATTEMPT_TTL_MS) return null;
  return attempt;
}

export function clearLatestAttempt(): void {
  try {
    sessionStorage.removeItem(LATEST_ATTEMPT_KEY);
  } catch {
    return;
  }
}

export async function fetchRecentBySource(
  source: 'dialog' | 'canvas',
): Promise<ProjectRecord[]> {
  return fetchProjectListQuery({ source }).then((page) => page.records);
}
