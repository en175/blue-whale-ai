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
  fetchPersonalSkill: vi.fn(),
  fetchSkillCategories: vi.fn(),
  fetchSkillContent: vi.fn(),
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
  api.fetchSkillLibrary.mockResolvedValue({
    current: 1,
    records: [
      {
        creative_skill_id: 'lib-skill',
        name: '分镜脚本',
        description: '测试技能',
        cover_url: 'https://example.com/lib-cover.png',
        asset_domain: 'official',
        usage_count: 12,
      },
    ],
    total: 1,
  });
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
  api.fetchSkillContent.mockResolvedValue({
    content: '---\nname: 海报生成\n---\n\n# 海报生成\n\n这是一个测试技能。',
  });
  api.fetchPersonalSkill.mockResolvedValue({ content: '# 个人技能\n\n这是个人技能正文。' });
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

  it('三个点菜单「查看」打开详情弹窗，右上角「使用」直接使用技能', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    const onUseSkill = vi.fn();
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(SkillModal, { open: true, onClose: vi.fn(), onUseSkill }));
    });

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === '我的技能')
        ?.click();
      await Promise.resolve();
    });

    // 点开卡片左上角三个点菜单
    await act(async () => {
      (document.body.querySelector('button[title="更多操作"]') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain('查看');

    // 点「查看」→ 拉取官方技能正文并展示详情弹窗
    await act(async () => {
      (document.body.querySelector('button[title="查看技能详情"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.fetchSkillContent).toHaveBeenCalledWith('official-skill');
    expect(document.body.textContent).toContain('这是一个测试技能');

    // 详情弹窗右上角「使用」→ 走与卡片「直接使用」同一出口
    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .findLast((button) => button.textContent === '使用')
        ?.click();
      await Promise.resolve();
    });
    expect(onUseSkill).toHaveBeenCalledWith(
      expect.objectContaining({ creative_skill_id: 'official-skill', name: '海报生成' }),
    );
  });

  it('技能库卡片三个点菜单「查看」打开详情弹窗，「使用」直接使用技能（IKD22K）', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    const onUseSkill = vi.fn();
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(SkillModal, { open: true, onClose: vi.fn(), onUseSkill }));
    });

    // 默认落在技能库 tab，显示技能库卡片
    expect(document.body.textContent).toContain('分镜脚本');

    // 点开技能库卡片左上角三个点菜单
    await act(async () => {
      (document.body.querySelector('button[title="更多操作"]') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain('查看');

    // 点「查看」→ 拉取官方技能正文并展示详情弹窗
    await act(async () => {
      (document.body.querySelector('button[title="查看技能详情"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.fetchSkillContent).toHaveBeenCalledWith('lib-skill');
    expect(document.body.textContent).toContain('这是一个测试技能');

    // 详情弹窗右上角「使用」→ 走与卡片「直接使用」同一出口
    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .findLast((button) => button.textContent === '使用')
        ?.click();
      await Promise.resolve();
    });
    expect(onUseSkill).toHaveBeenCalledWith(
      expect.objectContaining({ creative_skill_id: 'lib-skill', name: '分镜脚本' }),
    );
  });
});
