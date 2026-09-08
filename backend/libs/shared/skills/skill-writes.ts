import { fail, ok } from "@blue-whale/contracts";
import { parseSkillMd, serializeSkillMd } from "@blue-whale/core";
import {
  SkillAddConflictError,
  SkillInUseError,
  SkillNameConflictError,
  SkillNameReservedError,
} from "@lib/shared/persistence/index.js";
import type { SkillService } from "./skills.service.js";

const DATA_NOT_EXIST_CODE = 100100;
const SKILL_NAME_CONFLICT_CODE = 100101;
const SKILL_NAME_RESERVED_CODE = 100102;
const SKILL_ADD_CONFLICT_CODE = 100103;
const SKILL_IN_USE_CODE = 100105;

const CREATIVE_SKILL_ID_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;

function validateCreativeSkillId(creativeSkillId: string) {
  return CREATIVE_SKILL_ID_PATTERN.test(creativeSkillId)
    ? null
    : fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
}

export async function handleAddSkill(
  userId: string,
  creativeSkillId: string,
  skills: SkillService,
) {
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  const skillId = await skills.resolveOfficialSkillId(creativeSkillId);
  if (skillId === null) {
    return fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
  }
  try {
    await skills.addReference(userId, skillId);
  } catch (e) {
    if (e instanceof SkillAddConflictError) {
      return fail(
        SKILL_ADD_CONFLICT_CODE,
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
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  const officialId = await skills.resolveOfficialSkillId(creativeSkillId);
  if (officialId === null) {
    return fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
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
  if (!parsed) return fail(400, "SKILL.md 格式不合法：缺少 frontmatter");
  if (!parsed.name.trim()) return fail(400, "名称不能为空");
  if (!parsed.description.trim()) return fail(400, "简介不能为空");
  if (!parsed.body.trim()) return fail(400, "正文不能为空");
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
      return fail(SKILL_NAME_CONFLICT_CODE, "同名技能已存在");
    }
    if (e instanceof SkillNameReservedError) {
      return fail(SKILL_NAME_RESERVED_CODE, "名称与官方技能冲突");
    }
    throw e;
  }
}

export async function handleGetPersonalSkill(
  userId: string,
  creativeSkillId: string,
  skills: SkillService,
) {
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  const content = await skills.findPersonalContent(userId, creativeSkillId);
  if (!content) {
    return fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
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
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  try {
    const deleted = await skills.deletePersonal(userId, creativeSkillId);
    if (!deleted) {
      return fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
    }
    return ok();
  } catch (e) {
    if (e instanceof SkillInUseError) {
      return fail(
        SKILL_IN_USE_CODE,
        `技能「${e.skillName}」正在使用中，无法删除`,
      );
    }
    throw e;
  }
}
