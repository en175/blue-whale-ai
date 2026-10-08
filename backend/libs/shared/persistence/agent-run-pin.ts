import {
  agentRunPinSchema,
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
} from "@lib/contracts";
import { createHash } from "node:crypto";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function scrubCreativeSkillFromRunPin(
  pin: AgentRunPin,
  creativeSkillId: string,
): AgentRunPin {
  const { pin_digest: _pinDigest, ...pinSource } = pin;
  const scrubbed: Omit<AgentRunPin, "pin_digest"> = {
    ...pinSource,
    auto_creative_skill_candidates: pinSource.auto_creative_skill_candidates.filter(
      (candidate) => candidate.creative_skill_id !== creativeSkillId,
    ),
    creative_skill_resources: pinSource.creative_skill_resources.filter(
      (resource) => resource.creative_skill_id !== creativeSkillId,
    ),
  };
  const result: AgentRunPin = {
    ...scrubbed,
    pin_digest: sha256(canonicalAgentRunPinDigestInput(scrubbed)),
  };
  agentRunPinSchema.parse(result);
  return result;
}
