export function parseNewApiBearerToken(
  authorization: string | null,
): string | null {
  return /^Bearer (sk-\S+)$/.exec(authorization ?? "")?.[1] ?? null;
}
