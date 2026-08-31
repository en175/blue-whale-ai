// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillModal from './index';

const api = vi.hoisted(() => ({
  addLibrarySkill: vi.fn(),
  createPersonalSkill: vi.fn(),
  deletePersonalSkill: vi.fn(),
  fetchMySkills: vi.fn(),
  fetchSkillCategories: vi.fn(),
  fetchSkillLibrary: vi.fn(),
  formatPersonalSkill: vi.fn(),
  removeMySkill: vi.fn(),
}));

vi.mock('@/api/skills', () => api);
vi.mock('@/api/http', () => ({ isApiError: () => false }));

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  api.fetchSkillCategories.mockResolvedValue([]);
  api.fetchSkillLibrary.mockResolvedValue({ current: 1, records: [], total: 0 });
  api.fetchMySkills.mockResolvedValue({
    current: 1,
    records: [
      {
        creative_skill_id: 'official-skill',
        name: '海报生成',
        cover_url: 'https://example.com/cover.png',
        asset_domain: 'official',
      },
    ],
    total: 1,
  });
  api.removeMySkill.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
});

describe('SkillModal', () => {
  it('用 ConfirmModal 确认后才移除官方技能', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(SkillModal, { open: true, onClose: vi.fn() }));
    });

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === '我的技能')
        ?.click();
      await Promise.resolve();
    });

    await act(async () => {
      (document.body.querySelector('button[title="从我的技能移除"]') as HTMLButtonElement).click();
    });

    expect(api.removeMySkill).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('确认从「我的技能」移除「海报生成」？');

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .findLast((button) => button.textContent === '移除')
        ?.click();
      await Promise.resolve();
    });

    expect(api.removeMySkill).toHaveBeenCalledWith('official-skill');
  });
});
