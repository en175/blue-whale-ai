import { z } from "zod";


const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const stableIdSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const opaqueIdentitySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);

export const runtimeResourceSchema = z
  .object({
    resource_id: stableIdSchema,
    resource_version: z.string().min(1),
    kind: z.enum(["role", "rule", "runtime_skill"]),
    load_mode: z.enum(["always_on", "on_demand"]),
    media_type: z.string().min(1),
    content: z.string().min(1),
    content_digest: digestSchema,
  })
  .strict();

export const modelProfileSchema = z
  .object({
    model_profile_id: stableIdSchema,
    provider: stableIdSchema,
    model: z.string().min(1),
    context_window_tokens: z.number().int().positive(),
    tokenizer: z.string().min(1),
  })
  .strict();

export const runtimeBudgetPolicySchema = z
  .object({
    max_provider_calls: z.number().int().positive(),
    max_input_characters: z.number().int().positive(),
    max_output_characters: z.number().int().positive(),
    protocol_repair_attempts: z.number().int().nonnegative(),
  })
  .strict();

export const toolGrantSchema = z
  .object({
    tool_id: stableIdSchema,
    registry_version: z.number().int().positive(),
  })
  .strict();


export const autoCreativeSkillCandidateSchema = z
  .object({
    creative_skill_id: stableIdSchema,
    creative_skill_version_id: opaqueIdentitySchema,
    name: z.string().min(1),
    description: z.string().nullable(),
    display_version: z.string().min(1),
    resource_digest: digestSchema,
  })
  .strict();

const creativeSkillActivationBase = z.object({
  creative_skill_id: stableIdSchema,
  creative_skill_version_id: opaqueIdentitySchema,
  name: z.string().min(1),
  display_version: z.string().min(1),
  resource_digest: digestSchema,
});

const autoMatchReasonSchema = z
  .object({
    type: z.literal("agent_match"),
    detail: z
      .object({
        matched_fields: z
          .array(
            z.enum([
              "conversation_messages",
              "conversation_summary",
              "canvas_nodes",
              "project_metadata",
            ]),
          )
          .min(1)
          .refine((fields) => new Set(fields).size === fields.length),
      })
      .strict(),
  })
  .strict();

const forcedCreativeSkillActivationSchema = creativeSkillActivationBase
  .extend({
    source: z.literal("forced_use"),
    reason: z.object({ type: z.literal("user_use") }).strict(),
  })
  .strict();

export const autoCreativeSkillActivationSchema = creativeSkillActivationBase
  .extend({
    source: z.literal("auto"),
    reason: autoMatchReasonSchema,
  })
  .strict();

export const creativeSkillActivationSchema = z.discriminatedUnion("source", [
  forcedCreativeSkillActivationSchema,
  autoCreativeSkillActivationSchema,
]);

export const creativeSkillResourceSchema = autoCreativeSkillCandidateSchema
  .extend({
    media_type: z.literal("text/markdown"),
    body: z.string().min(1),
    content_digest: digestSchema,
  })
  .strict();

export const agentRunPinSchema = z
  .object({
    schema_version: z.literal(1),
    manifest_id: stableIdSchema,
    manifest_version: z.string().min(1),
    manifest_digest: digestSchema,
    pin_digest: digestSchema,
    resources: z.array(runtimeResourceSchema).min(1),
    role_resource_id: stableIdSchema,
    rule_resource_ids: z.array(stableIdSchema),
    runtime_skill_resource_ids: z.array(stableIdSchema),
    model_profile: modelProfileSchema,
    runtime_budget_policy: runtimeBudgetPolicySchema,
    tool_grants: z.array(toolGrantSchema),
    auto_creative_skill_candidates: z.array(autoCreativeSkillCandidateSchema),
    activated_creative_skill_versions: z
      .array(creativeSkillActivationSchema)
      .max(1),
    creative_skill_resources: z.array(creativeSkillResourceSchema),
  })
  .strict();


export type AgentRunPin = z.infer<typeof agentRunPinSchema>;
export type AutoCreativeSkillCandidate = z.infer<
  typeof autoCreativeSkillCandidateSchema
>;
export type AutoCreativeSkillActivation = z.infer<
  typeof autoCreativeSkillActivationSchema
>;
export type CreativeSkillActivation = z.infer<
  typeof creativeSkillActivationSchema
>;
export type CreativeSkillResource = z.infer<typeof creativeSkillResourceSchema>;

export function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJsonValue(entry)]),
    );
  }
  return value;
}

export function canonicalAgentRunPinDigestInput(
  pin: Omit<AgentRunPin, "pin_digest">,
): string {
  return JSON.stringify(canonicalizeJsonValue(pin));
}
