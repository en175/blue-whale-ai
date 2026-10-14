import { vi } from 'vitest';

type ConsoleInfo = typeof console.info;

export function silenceApiConsoleInfo(): void {
  const current = console.info as ConsoleInfo & { __apiSilenced?: boolean };
  if (current.__apiSilenced) return;
  const original: ConsoleInfo = current;
  const silenced = vi.spyOn(console, 'info').mockImplementation(((...args: Parameters<ConsoleInfo>) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[api] ')) return;
    original(...args);
  }) as ConsoleInfo) as unknown as ConsoleInfo & { __apiSilenced: boolean };
  silenced.__apiSilenced = true;
}
