import { ok, skillError } from "@blue-whale/contracts";
import { parseSkillMd, serializeSkillMd } from "@blue-whale/core";
import {
  SkillAddConflictError,
  SkillInUseError,
  SkillNameConflictError,
  SkillNameReservedError,
} from "@lib/shared/persistence/index.js";
import type { SkillService } from "./skills.service.js";

const CREATIVE_SKILL_ID_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;

/**
 * id 不合规就当「不存在」抛掉——**抛，不再返回信封**。
 *
 * 返回的信封走不到 `AllExceptionsFilter`，没人写 HTTP 状态码，于是一次「技能不存在」
 * 在 POST 上回 201、在 GET 上回 200，body 里却写着 100100。见 ADR-0083「落地记录」。
 */
function assertCreativeSkillId(creativeSkillId: string): void {
  if (!CREATIVE_SKILL_ID_PATTERN.test(creativeSkillId)) {
    throw skillError("SKILL_NOT_FOUND", `Skill 不存在: ${creativeSkillId}`);
  }
}

export async function handleAddSkill(
  userId: string,
  creativeSkillId: string,
  skills: SkillService,
) {
  assertCreativeSkillId(creativeSkillId);
  const skillId = await skills.resolveOfficialSkillId(creativeSkillId);
  if (skillId === null) {
    throw skillError("SKILL_NOT_FOUND", `Skill 不存在: ${creativeSkillId}`);
  }
  try {
    await skills.addReference(userId, skillId);
  } catch (e) {
    if (e instanceof SkillAddConflictError) {
      throw skillError(
        "SKILL_ADD_CONFLICT",
        `官方技能与你的个人技能「${e.officialSkillName}」同名，无法添加；你仍可直接使用`,
      );
    }
    throw e;
  }
  return ok();
}

export async function handleRemoveSkill(
  userId: string,
  creativeSkillId: string,
  skills: SkillService,
) {
  assertCreativeSkillId(creativeSkillId);
  const officialId = await skills.resolveOfficialSkillId(creativeSkillId);
  if (officialId === null) {
    throw skillError("SKILL_NOT_FOUND", `Skill 不存在: ${creativeSkillId}`);
  }
  await skills.removeReferenceByCreativeSkillId(userId, creativeSkillId);
  return ok();
}

export async function handleCreateSkill(
  userId: string,
  content: string,
  skills: SkillService,
) {
  const parsed = parseSkillMd(content);
  // 四条都是同一类「SKILL.md 不合法」，但文案各自点名缺了哪一格——码相同、话不同，
  // 用户才知道该改哪里。
  if (!parsed) throw skillError("SKILL_FORMAT_INVALID", "SKILL.md 格式不合法：缺少 frontmatter");
  if (!parsed.name.trim()) throw skillError("SKILL_FORMAT_INVALID", "名称不能为空");
  if (!parsed.description.trim()) throw skillError("SKILL_FORMAT_INVALID", "简介不能为空");
  if (!parsed.body.trim()) throw skillError("SKILL_FORMAT_INVALID", "正文不能为空");
  try {
    const result = await skills.createPersonalSkill(userId, {
      name: parsed.name.trim(),
      description: parsed.description.trim(),
      body: parsed.body,
    });
    return ok({
      creative_skill_id: result.creative_skill_id,
      name: result.name,
      description: result.description,
      cover_url: null,
      source: null,
      asset_domain: "personal" as const,
    });
  } catch (e) {
    if (e instanceof SkillNameConflictError) {
      throw skillError("SKILL_NAME_CONFLICT");
    }
    if (e instanceof SkillNameReservedError) {
      throw skillError("SKILL_NAME_RESERVED");
    }
    throw e;
  }
}

export async function handleGetPersonalSkill(
  userId: string,
  creativeSkillId: string,
  skills: SkillService,
) {
  assertCreativeSkillId(creativeSkillId);
  const content = await skills.findPersonalContent(userId, creativeSkillId);
  if (!content) {
    throw skillError("SKILL_NOT_FOUND", `Skill 不存在: ${creativeSkillId}`);
  }
  return ok({
    content: serializeSkillMd({
      name: content.name,
      description: content.description ?? "",
      body: content.body,
    }),
  });
}

export async function handleDeletePersonalSkill(
  userId: string,
  creativeSkillId: string,
  skills: SkillService,
) {
  assertCreativeSkillId(creativeSkillId);
  try {
    const deleted = await skills.deletePersonal(userId, creativeSkillId);
    if (!deleted) {
      throw skillError("SKILL_NOT_FOUND", `Skill 不存在: ${creativeSkillId}`);
    }
    return ok();
  } catch (e) {
    if (e instanceof SkillInUseError) {
      throw skillError(
        "SKILL_IN_USE",
        `技能「${e.skillName}」正在使用中，无法删除`,
      );
    }
    throw e;
  }
}
