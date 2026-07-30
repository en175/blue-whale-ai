export const serviceNames = [
  "agent-worker",
  "generation-worker",
] as const;

export type ServiceName = (typeof serviceNames)[number];

export interface ReadinessProbe {
  readonly name: string;
  check(): Promise<boolean>;
}

export interface DependencyReadiness {
  readonly name: string;
  readonly status: "ready" | "not_ready";
}

export interface ReadinessReport {
  readonly status: "ready" | "not_ready";
  readonly service: ServiceName;
  readonly dependencies: readonly DependencyReadiness[];
}

export async function checkReadiness(
  service: ServiceName,
  probes: readonly ReadinessProbe[],
): Promise<ReadinessReport> {
  const dependencies = await Promise.all(
    probes.map(async (probe) => ({
      name: probe.name,
      status: (await probe.check()) ? ("ready" as const) : ("not_ready" as const),
    })),
  );

  return {
    status: dependencies.every(({ status }) => status === "ready")
      ? "ready"
      : "not_ready",
    service,
    dependencies,
  };
}
