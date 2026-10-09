import type { Prisma } from "@prisma/client";

import type { DerivedReference } from "./plan-application-types.js";

export async function validateDerivedReferences(
  _tx: Prisma.TransactionClient,
  _projectId: bigint,
  derivedReferences: DerivedReference[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const reference of derivedReferences) {
    return { ok: false, reason: `mention ${reference.mention_id} not found` };
  }
  return { ok: true };
}
