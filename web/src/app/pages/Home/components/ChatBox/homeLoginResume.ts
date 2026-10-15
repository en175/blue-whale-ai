import type { SkillRecord } from '@/app/api/skills';

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
