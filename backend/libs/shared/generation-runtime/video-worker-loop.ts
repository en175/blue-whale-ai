export async function runVideoWorkerLoop(options: {
  runStep: () => Promise<string | null>;
  shouldStop: () => boolean;
  wait?: (milliseconds: number) => Promise<void>;
  idleDelayMs?: number;
}): Promise<void> {
  const wait = options.wait ?? defaultWait;
  const idleDelayMs = options.idleDelayMs ?? 500;
  while (!options.shouldStop()) {
    const jobId = await options.runStep();
    if (jobId === null) await wait(idleDelayMs);
  }
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
