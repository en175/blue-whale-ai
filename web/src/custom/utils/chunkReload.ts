const RELOAD_KEY = 'bw:chunk-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

let memoryLastReloadAt = 0;

export function shouldReloadChunk(
  lastReloadAt: number,
  now: number,
  cooldownMs: number = RELOAD_COOLDOWN_MS,
): boolean {
  return now - lastReloadAt >= cooldownMs;
}

function readLastReloadAt(storage: Pick<Storage, 'getItem'>): number {
  try {
    return Number(storage.getItem(RELOAD_KEY)) || 0;
  } catch {
    return memoryLastReloadAt;
  }
}

function writeLastReloadAt(storage: Pick<Storage, 'setItem'>, now: number): void {
  memoryLastReloadAt = now;
  try {
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return;
  }
}

export function installChunkReloadGuard(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    const now = Date.now();
    if (!shouldReloadChunk(readLastReloadAt(win.sessionStorage), now)) return;
    event.preventDefault();
    writeLastReloadAt(win.sessionStorage, now);
    win.location.reload();
  });
}
