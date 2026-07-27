export function publicGenerationInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { provider_credential: _credential, ...publicInput } = input as Record<
    string,
    unknown
  >;
  return publicInput;
}
