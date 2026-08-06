import {
  bundledAgentRuntimeManifest,
  validateAgentRuntimeManifest,
} from "@blue-whale/agent-runtime";
import type { AgentRuntimeManifest } from "@blue-whale/contracts";

export function validateAgentWorkerStartup(
  manifest: unknown = bundledAgentRuntimeManifest,
): AgentRuntimeManifest {
  return validateAgentRuntimeManifest(manifest);
}
