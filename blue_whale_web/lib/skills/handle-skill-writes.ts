import { fail, ok } from "@blue-whale/contracts";
import type { SkillRepo } from "@blue-whale/persistence";

const DATA_NOT_EXIST_CODE = 100100;

/** POST /api/agent/skills/library/{id}/add：加入「我的」（auto=false）。
 *  对齐 Java SkillServiceImpl.add：requireSkill + upsert。 */
export async function handleAddSkill(
  userId: string,
  skillId: string,
  deps: { skills: Pick<SkillRepo, "skillExists" | "addReference"> },
) {
  const exists = await deps.skills.skillExists(skillId);
  if (!exists) return fail(DATA_NOT_EXIST_CODE, `Skill 不存在: ${skillId}`);
  await deps.skills.addReference(userId, skillId);
  return ok();
}

/** DELETE /api/agent/skills/mine/{id}：移除「我的」（逻辑删，不删 skill 本体）。
 *  对齐 Java SkillServiceImpl.remove：delete 幂等。 */
export async function handleRemoveSkill(
  userId: string,
  skillId: string,
  deps: { skills: Pick<SkillRepo, "removeReference"> },
) {
  await deps.skills.removeReference(userId, skillId);
  return ok();
}

/** PATCH /api/agent/skills/mine/{id}：切 auto 开关（关系属性）。
 *  对齐 Java SkillServiceImpl.updateAuto：0 行 → DATA_NOT_EXIST。 */
export async function handleUpdateSkillAuto(
  userId: string,
  skillId: string,
  auto: boolean,
  deps: { skills: Pick<SkillRepo, "updateAuto"> },
) {
  const hit = await deps.skills.updateAuto(userId, skillId, auto);
  if (!hit) return fail(DATA_NOT_EXIST_CODE, "未添加该 Skill，无法设置 auto");
  return ok();
}
