import {
  agentRuntimeManifestSchema,
  type AgentRuntimeManifest,
} from "@blue-whale/contracts";
import { createHash } from "node:crypto";

const ROLE_CONTENT =
  "# Blue Whale Agent\n\nYou are Blue Whale, a creative collaborator. Answer the user's current request clearly and safely.";
const ORDINARY_CONVERSATION_RULE =
  "# Ordinary Conversation\n\nReturn one complete assistant message. Provide a short ReasoningSummary without revealing chain of thought.";

const MODEL_REGISTRY = new Set(["fake:deterministic-v1:fake-v1"]);
const TOOL_REGISTRY = new Set<string>();

const bundledManifestSource = {
  schema_version: 1,
  manifest_id: "blue_whale_default",
  manifest_version: "1.0.0",
  manifest_digest:
    "sha256:555b20ac1027311e6fce4c25a37e3f0bfd505700c1b64958e9d8b687a439b70c",
  resources: [
    {
      resource_id: "role.default",
      resource_version: "1.0.0",
      kind: "role",
      load_mode: "always_on",
      media_type: "text/markdown",
      content: ROLE_CONTENT,
      content_digest:
        "sha256:bb6b109327164994aaa053ca52fa0c7018c8a1cb9fbd6b1178c58a0a18dca4b0",
    },
    {
      resource_id: "rule.ordinary_conversation",
      resource_version: "1.0.0",
      kind: "rule",
      load_mode: "always_on",
      media_type: "text/markdown",
      content: ORDINARY_CONVERSATION_RULE,
      content_digest:
        "sha256:057fba21ffd34d8f1ac70b21e77dc3e14f804ed209c04e03a8b4428b0b58932e",
    },
  ],
  role_resource_id: "role.default",
  rule_resource_ids: ["rule.ordinary_conversation"],
  runtime_skill_resource_ids: [],
  model_profiles: [
    {
      model_profile_id: "fake.default",
      provider: "fake",
      model: "deterministic-v1",
      context_window_tokens: 8192,
      tokenizer: "fake-v1",
    },
  ],
  selected_model_profile_id: "fake.default",
  runtime_budget_policy: {
    max_provider_calls: 1,
    max_input_characters: 16_000,
    max_output_characters: 4_000,
    protocol_repair_attempts: 0,
  },
  tool_grants: [],
} as const;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`invalid AgentRuntimeManifest: duplicate ${label}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

export function validateAgentRuntimeManifest(
  input: unknown,
): AgentRuntimeManifest {
  const parsed = agentRuntimeManifestSchema.parse(input);
  requireUnique(
    parsed.resources.map((resource) => resource.resource_id),
    "resource identity",
  );
  requireUnique(
    parsed.model_profiles.map((profile) => profile.model_profile_id),
    "model profile identity",
  );
  requireUnique(parsed.rule_resource_ids, "rule resource reference");
  requireUnique(
    parsed.runtime_skill_resource_ids,
    "runtime skill resource reference",
  );
  requireUnique(
    parsed.tool_grants.map(
      (grant) => `${grant.tool_id}:${grant.registry_version}`,
    ),
    "tool grant",
  );

  const resources = new Map(
    parsed.resources.map((resource) => [resource.resource_id, resource]),
  );
  for (const resource of parsed.resources) {
    if (sha256(resource.content) !== resource.content_digest) {
      throw new Error(
        `invalid AgentRuntimeManifest: resource digest mismatch (${resource.resource_id})`,
      );
    }
  }

  const roleResources = parsed.resources.filter(
    (resource) => resource.kind === "role",
  );
  const role = resources.get(parsed.role_resource_id);
  if (
    roleResources.length !== 1 ||
    !role ||
    role.kind !== "role" ||
    role.load_mode !== "always_on"
  ) {
    throw new Error("invalid AgentRuntimeManifest: role resource reference");
  }
  for (const resourceId of parsed.rule_resource_ids) {
    if (resources.get(resourceId)?.kind !== "rule") {
      throw new Error("invalid AgentRuntimeManifest: rule resource reference");
    }
  }
  for (const resourceId of parsed.runtime_skill_resource_ids) {
    if (resources.get(resourceId)?.kind !== "runtime_skill") {
      throw new Error(
        "invalid AgentRuntimeManifest: runtime skill resource reference",
      );
    }
  }
  const referencedResources = new Set([
    parsed.role_resource_id,
    ...parsed.rule_resource_ids,
    ...parsed.runtime_skill_resource_ids,
  ]);
  if (referencedResources.size !== parsed.resources.length) {
    throw new Error("invalid AgentRuntimeManifest: unreferenced resource");
  }

  const selectedProfile = parsed.model_profiles.find(
    (profile) =>
      profile.model_profile_id === parsed.selected_model_profile_id,
  );
  if (!selectedProfile) {
    throw new Error("invalid AgentRuntimeManifest: model profile reference");
  }
  for (const profile of parsed.model_profiles) {
    const registryKey = `${profile.provider}:${profile.model}:${profile.tokenizer}`;
    if (!MODEL_REGISTRY.has(registryKey)) {
      throw new Error("invalid AgentRuntimeManifest: model registry reference");
    }
  }
  for (const grant of parsed.tool_grants) {
    if (!TOOL_REGISTRY.has(`${grant.tool_id}:${grant.registry_version}`)) {
      throw new Error("invalid AgentRuntimeManifest: tool registry reference");
    }
  }

  const { manifest_digest: manifestDigest, ...digestSource } = parsed;
  if (sha256(JSON.stringify(canonicalize(digestSource))) !== manifestDigest) {
    throw new Error("invalid AgentRuntimeManifest: manifest digest mismatch");
  }

  return deepFreeze(structuredClone(parsed));
}

export const bundledAgentRuntimeManifest = validateAgentRuntimeManifest(
  bundledManifestSource,
);
