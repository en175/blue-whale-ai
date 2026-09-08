// IKCKOW：buildAgentRunPin / resolveForcedSkill / toResource 仅被将删除的
// conversation-repo（acceptConversationMessageInTransaction）使用，随其删除。
// 保留 scrubCreativeSkillFromRunPin（skill-repo deletePersonal run_pin 清扫使用）。
import {
  agentRunPinSchema,
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
} from "@blue-whale/contracts";
import { createHash } from "node:crypto";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** 从 RunPin 移除指定个人技能的正文供应（契约 §13.2，IK6B2H）：
 *  从 auto_creative_skill_candidates / creative_skill_resources 移除该
 *  creative_skill_id 的全部条目（正文供应随之消失），保留
 *  activated_creative_skill_versions（不含 body，天然是「曾使用」最小事实）；
 *  重算 pin_digest 保持快照内部自洽。幂等：pin 中无该技能时输出与输入等价。 */
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
  // parse 仅校验；返回值不取自 parse——zod 按 schema 定义序重建 key（pin_digest
  // 提前），会使「无变化 scrub」的 JSON 字符串与原始值不等价，破坏调用方 no-op 判断。
  agentRunPinSchema.parse(result);
  return result;
}
