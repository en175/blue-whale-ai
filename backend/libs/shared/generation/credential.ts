import {
  GenerationCredentialConfigurationError,
  NewApiError,
  loadGenerationCredentialSecret,
  sealGenerationCredential,
} from "@blue-whale/core";

/** 把请求方 sk-token 密封成 job 凭证（worker 解密后调网关）。未携带/非 sk- → 空。 */
export function sealProviderCredential(
  authorization: string | undefined,
): { providerCredential?: string } {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : undefined;
  if (!token?.startsWith("sk-")) return {};
  try {
    return {
      providerCredential: sealGenerationCredential(
        token,
        loadGenerationCredentialSecret(),
      ),
    };
  } catch (error) {
    if (error instanceof GenerationCredentialConfigurationError) {
      throw new NewApiError("生成服务暂不可用", 503);
    }
    throw error;
  }
}
