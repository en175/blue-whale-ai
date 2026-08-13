/** new-api sk token：`Bearer sk-...`，非此格式视为未携带。 */
export function parseBearerToken(
  authorization: string | undefined | null,
): string | null {
  return /^Bearer (sk-\S+)$/.exec(authorization ?? "")?.[1] ?? null;
}
