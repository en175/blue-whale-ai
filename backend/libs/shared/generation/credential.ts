import { NewApiError } from "@blue-whale/core";

/** 把请求方 sk-token 直接透传为 job 凭证（修正四：去密封，明文存 job.input.provider_credential）。未携带/非 sk- → 空。 */
export function sealProviderCredential(
  authorization: string | undefined,
): { providerCredential?: string } {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : undefined;
  if (!token?.startsWith("sk-")) return {};
  // 修正四：不再 AES 密封，明文透传（worker 直接取用）。原 seal 失败抛 503 分支已无意义。
  return { providerCredential: token };
}
