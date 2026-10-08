import {
  createNewApiRequest,
  createNewApiRequestWithMeta,
} from "./new-api-transport.js";
import { createNewApiGenerationOps } from "./new-api-generation-ops.js";
import { createNewApiUpstreamOps } from "./new-api-upstream-ops.js";
import type { NewApiClientOptions } from "./new-api-types.js";

export * from "./new-api-types.js";
export {
  createNewApiRawRequest,
  type NewApiRawRequest,
  type NewApiRawResult,
  NewApiError,
  NewApiTimeoutError,
  NewApiNetworkError,
  CLIENT_SYSTEM_BLUEWHALE,
} from "./new-api-transport.js";

export function createNewApiClient(options: NewApiClientOptions) {
  const request = createNewApiRequest(options);
  const requestWithMeta = createNewApiRequestWithMeta(options);
  return {
    ...createNewApiGenerationOps(request, requestWithMeta),
    ...createNewApiUpstreamOps(request),
  };
}
