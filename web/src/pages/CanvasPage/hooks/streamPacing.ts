
const CATCH_UP_MS = 400;
const MIN_CHARS_PER_SECOND = 24;
const MAX_CHARS_PER_SECOND = 240;

export interface RevealInput {
  revealed: number;
  received: number;
  elapsedMs: number;
  done: boolean;
}

export function advanceReveal({ revealed, received, elapsedMs, done }: RevealInput): number {
  if (done) return received;
  const pending = received - revealed;
  if (pending <= 0) return Math.min(revealed, received);
  const charsPerSecond = Math.min(
    MAX_CHARS_PER_SECOND,
    Math.max(MIN_CHARS_PER_SECOND, pending / (CATCH_UP_MS / 1000)),
  );
  return Math.min(received, revealed + (charsPerSecond * Math.max(0, elapsedMs)) / 1000);
}

export function hasPendingReveal(revealed: number, received: number): boolean {
  return Math.floor(revealed) < received;
}
