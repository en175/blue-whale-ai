// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetRecord } from '@/app/api/assets';
import AssetDetailModal from './index';


let root: Root;
let mountNode: HTMLDivElement;

const baseAsset: AssetRecord = {
  id: '6494',
  type: 'image',
  url: 'https://tos.test/a.png',
  width: 1024,
  height: 1024,
  duration: null,
  size: 2048,
  source: 'generated',
  model: 'Seedream 5.0 Lite',
  created_at: '2026-09-15T00:00:00.000Z',
};

async function renderModal(asset: AssetRecord | null) {
  await act(async () => {
    root.render(createElement(AssetDetailModal, { asset, onClose: () => {} }));
  });
}

function promptRowText(): string | null {
  const item = [...document.body.querySelectorAll('dl > div')].find(
    (el) => el.querySelector('dt')?.textContent === '提示词',
  );
  return item ? (item.querySelector('dd')?.textContent ?? '') : null;
}

function fieldLabels(): (string | null)[] {
  return [...document.body.querySelectorAll('dl dt')].map((el) => el.textContent);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('AssetDetailModal 提示词行（IKFTQW）', () => {
  it('有提示词时按原文渲染', async () => {
    await renderModal({ ...baseAsset, prompt: '一只白鲸穿过蓝色鲸落' });

    expect(promptRowText()).toBe('一只白鲸穿过蓝色鲸落');
    expect(fieldLabels()).toContain('提示词');
  });

  it.each([
    ['详情还没回来（undefined）', undefined],
    ['接口返回 null', null],
    ['接口返回空串', ''],
  ])('%s 时不渲染提示词行', async (_label, prompt) => {
    await renderModal({ ...baseAsset, prompt });

    expect(promptRowText()).toBeNull();
    expect(fieldLabels()).toEqual(['来源', '创建时间', '分辨率', '大小', '生成模型']);
  });

  it('超长提示词原样渲染，不截断（高度由详情栏滚动承接）', async () => {
    const longPrompt = '鲸'.repeat(4000);
    await renderModal({ ...baseAsset, prompt: longPrompt });

    expect(promptRowText()).toBe(longPrompt);
  });
});
