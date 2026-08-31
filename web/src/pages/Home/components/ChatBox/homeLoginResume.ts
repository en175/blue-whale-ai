/* ============================================
 * 首页未登录动作续接：Skill / 发送共用单一 pending
 * 模板卡只填输入框，不拦登录。
 * ============================================ */
import type { SkillRecord } from '@/api/skills';

export type HomePendingAction =
  | { kind: 'open-skill' }
  | { kind: 'use-skill'; skill: SkillRecord }
  | { kind: 'send'; text: string };

export type HomeLoginResume =
  | { action: 'none' }
  | { action: 'open-skill' }
  | { action: 'use-skill'; skill: SkillRecord }
  | { action: 'send'; text: string }
  | { action: 'restore-text'; text: string };

/** 登录窗关闭后根据 pending 与当前登录态决定续接或清理。 */
export function resolveHomeLoginResume(
  pending: HomePendingAction | null,
  loggedIn: boolean,
): HomeLoginResume {
  if (!pending) return { action: 'none' };
  if (!loggedIn) {
    if (pending.kind === 'send') return { action: 'restore-text', text: pending.text };
    return { action: 'none' };
  }
  switch (pending.kind) {
    case 'open-skill':
      return { action: 'open-skill' };
    case 'use-skill':
      return { action: 'use-skill', skill: pending.skill };
    case 'send':
      return { action: 'send', text: pending.text };
  }
}
