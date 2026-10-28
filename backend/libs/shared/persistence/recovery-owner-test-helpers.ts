import type { PrismaClient } from "@prisma/client";

import { createCanvasRepo } from "./canvas-repo.js";
import { loadRecoveryOwners } from "./generation-canvas-recovery-repo.js";

export interface EffectiveRecoveryOwner {
  node_id: string;
  generation_canvas_submission_id: bigint;
  output_key: string;
  binding_revision: number;
}

export async function effectiveCanvasRow(
  prisma: PrismaClient,
  projectId: bigint | string,
): Promise<Record<string, unknown> | null> {
  const row = await prisma.project_canvas.findUnique({ where: { project_id: BigInt(projectId) } });
  if (!row) return null;
  const view = await createCanvasRepo(prisma).getByProject(projectId.toString());
  return {
    ...row,
    nodes_json: JSON.parse(view.nodes ?? "[]") as unknown,
    edges_json: JSON.parse(view.edges ?? "[]") as unknown,
  };
}

export async function findEffectiveRecoveryOwners(
  prisma: PrismaClient,
  projectId: bigint | string,
): Promise<EffectiveRecoveryOwner[]> {
  const owners = await loadRecoveryOwners(prisma, BigInt(projectId));
  return [...owners.entries()].map(([nodeId, owner]) => ({
    node_id: nodeId,
    generation_canvas_submission_id: owner.submissionId,
    output_key: owner.outputKey,
    binding_revision: owner.bindingRevision,
  }));
}

export async function findEffectiveRecoveryOwner(
  prisma: PrismaClient,
  projectId: bigint | string,
  nodeId: string,
): Promise<EffectiveRecoveryOwner | null> {
  const owners = await loadRecoveryOwners(prisma, BigInt(projectId), [nodeId]);
  const owner = owners.get(nodeId);
  return owner
    ? {
        node_id: nodeId,
        generation_canvas_submission_id: owner.submissionId,
        output_key: owner.outputKey,
        binding_revision: owner.bindingRevision,
      }
    : null;
}

export async function requireEffectiveRecoveryOwner(
  prisma: PrismaClient,
  projectId: bigint | string,
  nodeId: string,
): Promise<EffectiveRecoveryOwner> {
  const owner = await findEffectiveRecoveryOwner(prisma, projectId, nodeId);
  if (owner === null) throw new Error(`缺少节点 ${nodeId} 的承接记录`);
  return owner;
}

export async function countEffectiveRecoveryOwners(
  prisma: PrismaClient,
  projectId: bigint | string,
): Promise<number> {
  return (await findEffectiveRecoveryOwners(prisma, projectId)).length;
}

export async function clearEffectiveRecoveryOwners(
  prisma: PrismaClient,
  projectId: bigint | string,
): Promise<void> {
  await prisma.project_nodes.updateMany({
    where: { project_id: BigInt(projectId), owner_submission_id: { not: null } },
    data: { owner_submission_id: null, owner_output_key: null, owner_binding_revision: 0 },
  });
}

export async function clearEffectiveRecoveryOwner(
  prisma: PrismaClient,
  projectId: bigint | string,
  nodeId: string,
): Promise<void> {
  await prisma.project_nodes.updateMany({
    where: { project_id: BigInt(projectId), node_id: nodeId },
    data: { owner_submission_id: null, owner_output_key: null, owner_binding_revision: 0 },
  });
}
