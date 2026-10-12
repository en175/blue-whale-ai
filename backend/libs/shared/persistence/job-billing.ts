export interface JobBilling {
  charge(jobId: number): Promise<void>;
  release(jobId: number, reason: string): Promise<void>;
}

export async function withBillingCompensation<T>(
  billing: JobBilling | undefined,
  run: (billing: JobBilling | undefined) => Promise<T>,
): Promise<T> {
  if (!billing) return run(undefined);
  const held = { jobId: null as number | null };
  try {
    return await run({
      charge: async (jobId) => {
        await billing.charge(jobId);
        held.jobId = jobId;
      },
      release: billing.release,
    });
  } catch (error) {
    const heldJobId = held.jobId;
    if (heldJobId !== null) {
      await billing.release(
        heldJobId,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }
}
