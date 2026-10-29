import { createHash } from "node:crypto";

export function operationRef(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function parseOperationDetail(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
