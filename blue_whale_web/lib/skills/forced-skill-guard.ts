import type { ForcedCreativeSkillGuard } from "@blue-whale/core";
import type { SkillRepo } from "@blue-whale/persistence";

/**
 * forced Creative Skill 域/owner 守卫（资产契约 §4/§7）：
 * official 域放行；personal 域仅本人；未知 ID 拒绝（不泄露存在性）。
 * conversation 与 generation-inbox 两条接纳路径共用（IK60WY）。
 */
export function createForcedSkillGuard(
  skills: Pick<SkillRepo, "findAssetDomainInfo">,
): ForcedCreativeSkillGuard {
  return async (userId, forcedCreativeSkillId) => {
    const info = await skills.findAssetDomainInfo(forcedCreativeSkillId);
    if (info === null) return false;
    if (info.asset_domain === "official") return true;
    return info.owner_user_id === userId;
  };
}
