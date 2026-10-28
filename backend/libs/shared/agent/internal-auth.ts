import { timingSafeEqual } from "node:crypto";

export interface TrustedAgentContext {
  tenantId: string;
  userId: string;
  projectId: string;
  sessionId: string;
}

export function authorizedAgentService(header: string | undefined): boolean {
  const expected = process.env.AGENT_SERVICE_TOKEN?.trim();
  const supplied = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : "";
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export function requiredDecimalHeader(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
}

export function trustedAgentContext(headers: {
  tenantId: string | undefined;
  userId: string | undefined;
  projectId: string | undefined;
  sessionId: string | undefined;
}): TrustedAgentContext | null {
  const tenantId = headers.tenantId?.trim();
  const userId = requiredDecimalHeader(headers.userId);
  const projectId = requiredDecimalHeader(headers.projectId);
  const sessionId = headers.sessionId?.trim();
  if (!tenantId || !userId || !projectId || !sessionId || sessionId.length > 128) return null;
  return { tenantId, userId, projectId, sessionId };
}
