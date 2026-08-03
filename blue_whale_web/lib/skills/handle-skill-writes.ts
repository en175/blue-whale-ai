import { fail, ok } from "@blue-whale/contracts";
import {
  SkillAddConflictError,
  SkillNameConflictError,
  SkillNameReservedError,
  type SkillRepo,
} from "@blue-whale/persistence";
import { parseSkillMd, serializeSkillMd } from "./skill-md";

export { parseSkillMd };

const DATA_NOT_EXIST_CODE = 100100;
const SKILL_NAME_CONFLICT_CODE = 100101;
const SKILL_NAME_RESERVED_CODE = 100102;
const SKILL_ADD_CONFLICT_CODE = 100103;
const SKILL_FORMAT_FAILED_CODE = 100104;

/** 稳定身份格式（契约 §2）：注册命令只接受 creative_skill_id，非法一律按不存在处理（§7）。 */
const CREATIVE_SKILL_ID_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;

/** 格式非法 → 100100（契约 §7「非法即不存在」）；合法返回 null 放行。 */
function validateCreativeSkillId(creativeSkillId: string) {
  return CREATIVE_SKILL_ID_PATTERN.test(creativeSkillId)
    ? null
    : fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
}

/** POST /api/agent/skills/library/{id}/add：加入「我的」（auto=false），{id} 即 creative_skill_id。
 *  resolve official 域映射 → 内部 id 后 upsert；未知/个人域/格式非法 → 100100（契约 §6/§7）；
 *  与同用户个人技能 Name Key 冲突 → 100103（契约 §5.4，IK60WX）。 */
export async function handleAddSkill(
  userId: string,
  creativeSkillId: string,
  deps: { skills: Pick<SkillRepo, "resolveOfficialSkillId" | "addReference"> },
) {
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  const skillId = await deps.skills.resolveOfficialSkillId(creativeSkillId);
  if (skillId === null) {
    return fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
  }
  try {
    await deps.skills.addReference(userId, skillId);
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

/** DELETE /api/agent/skills/mine/{id}：移除「我的」（逻辑删，不删 skill 本体），{id} 即 creative_skill_id。
 *  未知/个人域/格式非法 → 100100（契约 §6/§7）；官方域但未添加 → 逻辑删幂等，仍 ok。 */
export async function handleRemoveSkill(
  userId: string,
  creativeSkillId: string,
  deps: {
    skills: Pick<
      SkillRepo,
      "resolveOfficialSkillId" | "removeReferenceByCreativeSkillId"
    >;
  },
) {
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  const officialId = await deps.skills.resolveOfficialSkillId(creativeSkillId);
  if (officialId === null) {
    return fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
  }
  await deps.skills.removeReferenceByCreativeSkillId(userId, creativeSkillId);
  return ok();
}

/** PATCH /api/agent/skills/mine/{id}：切 auto 开关（关系属性），{id} 即 creative_skill_id。
 *  格式非法 → 100100；resolve 未命中（未知/个人域/未添加）→ 100100（契约 §6/§7）。 */
export async function handleUpdateSkillAuto(
  userId: string,
  creativeSkillId: string,
  auto: boolean,
  deps: { skills: Pick<SkillRepo, "updateAutoByCreativeSkillId"> },
) {
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  const hit = await deps.skills.updateAutoByCreativeSkillId(
    userId,
    creativeSkillId,
    auto,
  );
  if (!hit) return fail(DATA_NOT_EXIST_CODE, "未添加该 Skill，无法设置 auto");
  return ok();
}

/** POST /api/agent/skills/personal：从 SKILL.md 文本创建个人技能（IK60WU）。
 *  解析 frontmatter → 校验 → 创建；名称冲突 → 100101；官方保留名 → 100102。 */
export async function handleCreateSkill(
  userId: string,
  content: string,
  deps: { skills: Pick<SkillRepo, "createPersonalSkill"> },
) {
  const parsed = parseSkillMd(content);
  if (!parsed) return fail(400, "SKILL.md 格式不合法：缺少 frontmatter");
  if (!parsed.name.trim()) return fail(400, "名称不能为空");
  if (!parsed.description.trim()) return fail(400, "简介不能为空");
  if (!parsed.body.trim()) return fail(400, "正文不能为空");
  try {
    const result = await deps.skills.createPersonalSkill(userId, {
      name: parsed.name.trim(),
      description: parsed.description.trim(),
      body: parsed.body,
    });
    return ok({
      creative_skill_id: result.creative_skill_id,
      auto: false,
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

/** POST /api/agent/skills/personal/format：AI 格式化当前草稿（IK60X0）。
 *  后台固定规则（deps.rules，用户不可改）+ 受控 AI 接口产出完整替换文本；
 *  纯文本变换，不触碰持久化、不创建资产。AI 抛错或返回非合法 SKILL.md
 *  （frontmatter 缺失 / name / description / 正文任一为空）→ 100104，
 *  前端据此保留原草稿，不产生部分覆盖。 */
export async function handleFormatSkillDraft(
  content: string,
  deps: {
    ai: {
      complete(input: { rules: string; draft: string }): Promise<string>;
    };
    rules: string;
  },
) {
  if (!content.trim()) return fail(400, "草稿内容为空，无法格式化");
  let formatted: string;
  try {
    formatted = await deps.ai.complete({ rules: deps.rules, draft: content });
  } catch {
    return fail(SKILL_FORMAT_FAILED_CODE, "AI 格式化失败，请稍后重试");
  }
  const parsed = typeof formatted === "string" ? parseSkillMd(formatted) : null;
  if (
    !parsed ||
    !parsed.name.trim() ||
    !parsed.description.trim() ||
    !parsed.body.trim()
  ) {
    return fail(SKILL_FORMAT_FAILED_CODE, "AI 返回内容无效，已保留原草稿");
  }
  return ok({ content: formatted });
}

/** GET /api/agent/skills/personal/{id}：owner 只读正文（契约 §13.1，IK60WZ）。
 *  owner + personal 谓词在 repo 层强制；官方域/非 owner/未知/格式非法 → 100100，
 *  不泄露存在性。命中时重建完整 SKILL.md 文本返回（只读，无编辑/下载语义）。 */
export async function handleGetPersonalSkill(
  userId: string,
  creativeSkillId: string,
  deps: { skills: Pick<SkillRepo, "findPersonalContent"> },
) {
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  const content = await deps.skills.findPersonalContent(
    userId,
    creativeSkillId,
  );
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

/** DELETE /api/agent/skills/personal/{id}：owner 永久删除个人技能（契约 §13.2，IK60WZ）。
 *  物理删本体与版本行，不可逆；官方域/非 owner/未知/格式非法/重复删 → 100100。 */
export async function handleDeletePersonalSkill(
  userId: string,
  creativeSkillId: string,
  deps: { skills: Pick<SkillRepo, "deletePersonal"> },
) {
  const invalid = validateCreativeSkillId(creativeSkillId);
  if (invalid) return invalid;
  const deleted = await deps.skills.deletePersonal(userId, creativeSkillId);
  if (!deleted) {
    return fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
  }
  return ok();
}
