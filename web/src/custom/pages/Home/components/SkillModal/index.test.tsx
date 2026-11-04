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

vi.mock('@/custom/api/skills', () => api);
vi.mock('@/shared/api/http', () => ({ isApiError: () => false }));

let root: Root;
let mountNode: HTMLDivElement;

function pointerClick(target: EventTarget) {
  const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' };
  target.dispatchEvent(new PointerEvent('pointerdown', init));
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new PointerEvent('pointerup', init));
  target.dispatchEvent(new MouseEvent('mouseup', init));
  target.dispatchEvent(new MouseEvent('click', init));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const proto = HTMLElement.prototype as HTMLElement & {
    hasPointerCapture?: (id: number) => boolean;
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
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
  api.addLibrarySkill.mockResolvedValue(undefined);
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

    await act(async () => {
      pointerClick(document.body.querySelector('button[title="更多操作"]') as HTMLButtonElement);
    });
    expect(document.body.textContent).toContain('查看');

    await act(async () => {
      pointerClick(document.body.querySelector('[title="查看技能详情"]') as HTMLElement);
      await Promise.resolve();
    });
    expect(api.fetchSkillContent).toHaveBeenCalledWith('official-skill');
    expect(document.body.textContent).toContain('这是一个测试技能');

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

    expect(document.body.textContent).toContain('分镜脚本');

    await act(async () => {
      pointerClick(document.body.querySelector('button[title="更多操作"]') as HTMLButtonElement);
    });
    expect(document.body.textContent).toContain('查看');

    await act(async () => {
      pointerClick(document.body.querySelector('[title="查看技能详情"]') as HTMLElement);
      await Promise.resolve();
    });
    expect(api.fetchSkillContent).toHaveBeenCalledWith('lib-skill');
    expect(document.body.textContent).toContain('这是一个测试技能');

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

  it('页签从左到右为「技能库、我的技能」，默认展示技能库', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(SkillModal, { open: true, onClose: vi.fn() }));
    });

    const tabButtons = [...document.body.querySelectorAll('button')].filter((button) =>
      ['技能库', '我的技能'].includes(button.textContent ?? ''),
    );
    expect(tabButtons.map((button) => button.textContent)).toEqual(['技能库', '我的技能']);
    expect(document.body.textContent).toContain('分镜脚本');
  });

  it('移除官方技能后，技能库卡片恢复为「添加」（IKST2N）', async () => {
    api.fetchMySkills.mockResolvedValue({
      current: 1,
      records: [
        {
          creative_skill_id: 'lib-skill',
          name: '分镜脚本',
          cover_url: 'https://example.com/lib-cover.png',
          asset_domain: 'official',
        },
      ],
      total: 1,
    });
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(SkillModal, { open: true, onClose: vi.fn() }));
    });

    const cardButton = (text: string) =>
      [...document.body.querySelectorAll('button')].find(
        (button) => button.textContent === text && button.closest('[class*="cardFooter"]'),
      );

    await act(async () => {
      cardButton('添加')?.click();
      await Promise.resolve();
    });
    expect(api.addLibrarySkill).toHaveBeenCalledWith('lib-skill');
    expect(cardButton('已添加')).toBeTruthy();

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === '我的技能')
        ?.click();
      await Promise.resolve();
    });

    await act(async () => {
      (document.body.querySelector('button[title="从我的技能移除"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .findLast((button) => button.textContent === '移除')
        ?.click();
      await Promise.resolve();
    });
    expect(api.removeMySkill).toHaveBeenCalledWith('lib-skill');

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === '技能库')
        ?.click();
      await Promise.resolve();
    });
    expect(cardButton('已添加')).toBeUndefined();
    expect(cardButton('添加')).toBeTruthy();
  });

  it('「我的技能」为空时展示空态，点击「去技能库」切到技能库', async () => {    api.fetchMySkills.mockResolvedValue({ current: 1, records: [], total: 0 });
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
    expect(document.body.textContent).toContain('暂无技能');
    expect(document.body.textContent).toContain('前往技能库，添加你需要的技能');

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === '去技能库')
        ?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain('暂无技能');
    expect(document.body.textContent).toContain('分镜脚本');
  });

  it('按 Esc 关闭技能库弹窗', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    const onClose = vi.fn();
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(SkillModal, { open: true, onClose }));
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('详情弹窗打开时按 Esc 只关闭详情，主弹窗保持打开', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    const onClose = vi.fn();
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(SkillModal, { open: true, onClose }));
    });

    await act(async () => {
      pointerClick(document.body.querySelector('button[title="更多操作"]') as HTMLButtonElement);
    });
    expect(document.body.textContent).toContain('查看');

    await act(async () => {
      pointerClick(document.body.querySelector('[title="查看技能详情"]') as HTMLElement);
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('这是一个测试技能。');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.body.textContent).not.toContain('这是一个测试技能。');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('弹窗关闭后按 Esc 不再触发关闭回调', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    const onClose = vi.fn();
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(SkillModal, { open: false, onClose }));
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
