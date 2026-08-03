import { fail, ok } from "@blue-whale/contracts";
import type { SkillRepo } from "@blue-whale/persistence";

const DATA_NOT_EXIST_CODE = 100100;

/** 稳定身份格式（契约 §2）：注册命令只接受 creative_skill_id，非法一律按不存在处理（§7）。 */
const CREATIVE_SKILL_ID_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;

/** 格式非法 → 100100（契约 §7「非法即不存在」）；合法返回 null 放行。 */
function validateCreativeSkillId(creativeSkillId: string) {
  return CREATIVE_SKILL_ID_PATTERN.test(creativeSkillId)
    ? null
    : fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${creativeSkillId}`);
}

/** POST /api/agent/skills/library/{id}/add：加入「我的」（auto=false），{id} 即 creative_skill_id。
 *  resolve official 域映射 → 内部 id 后 upsert；未知/个人域/格式非法 → 100100（契约 §6/§7）。 */
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
  await deps.skills.addReference(userId, skillId);
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
