/**
 * SkillRecommendationSection —— Agent 对话面板消息区顶部的 Creative Skill 推荐区（IK3NPI）。
 *
 * 展示当前 Run 的推荐列表（name/description + Use），空态给一行简短文案。
 * 点 Use 复用 forced Use 链路：上抛 { creative_skill_id, name }（推荐项必有稳定 id）。
 */
import type { CreativeSkillRecommendation } from "@/components/api/skills";
import type { UseSkillSelection } from "@/components/SkillPanel";

export function SkillRecommendationSection({
  recommendations,
  loading,
  onUse,
}: {
  recommendations: CreativeSkillRecommendation[];
  loading: boolean;
  onUse: (skill: UseSkillSelection) => void;
}) {
  return (
    <section
      className="tc-agent-skill-reco flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.035] px-2.5 py-2"
      aria-label="推荐技能"
    >
      <div className="tc-agent-skill-reco__title text-[11px] font-medium tracking-[0.02em] text-white/55">
        推荐技能
      </div>
      {loading ? (
        <div className="tc-agent-skill-reco__empty text-xs text-white/40">
          加载中…
        </div>
      ) : recommendations.length === 0 ? (
        <div className="tc-agent-skill-reco__empty text-xs text-white/40">
          暂无推荐技能
        </div>
      ) : (
        <ul className="tc-agent-skill-reco__list flex flex-col gap-1.5">
          {recommendations.map((item) => (
            <li
              key={item.creative_skill_id}
              className="tc-agent-skill-reco__row flex items-center gap-2"
            >
              <span className="tc-agent-skill-reco__body flex min-w-0 flex-col gap-0.5">
                <span className="tc-agent-skill-reco__name truncate text-xs font-semibold text-white/90">
                  {item.name}
                </span>
                <span className="tc-agent-skill-reco__desc line-clamp-2 text-[11px] leading-relaxed text-white/55">
                  {item.description || "—"}
                </span>
              </span>
              <button
                type="button"
                className="tc-agent-skill-reco__use ml-auto inline-flex h-7 flex-shrink-0 items-center rounded-md border border-white/[0.08] px-2 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
                onClick={() =>
                  onUse({
                    creative_skill_id: item.creative_skill_id,
                    name: item.name,
                  })
                }
              >
                使用
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
