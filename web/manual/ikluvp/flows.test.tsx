// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { createLab } from './server';
import { handleCreateGenerationJob } from '../../../backend/libs/shared/generation/handle-create-generation-job';
import { parseModelUpdateBody } from '../../../backend/libs/shared/model-capability/constants';
import { toFeatures } from '../../../backend/libs/shared/persistence/model-capability-repo';
import { clickSelectOption } from '@/custom/pages/CanvasPage/testing/radixSelect';

it.each(['C3', 'C4', 'C5', 'H1', 'A1'])('验收场景 %s 可操作并生成证据', async (caseId) => {
  vi.resetModules(); localStorage.clear();
  (window as any).ikluvpPreview = '/__ikluvp/reference';
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 900 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 650 });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, '', `?case=${caseId}`);
  document.body.innerHTML = '<div id="root"></div>';
  const events: any[] = [];
  const post = vi.spyOn(window, 'postMessage').mockImplementation(data => { events.push(data); });
  const lab = createLab(async () => ({ handleCreateGenerationJob, parseModelUpdateBody, toFeatures }));
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const result = await lab(init?.method ?? 'GET', new URL(input, location.origin).pathname,
      init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  }));
  let runtime: typeof import('./runtime');
  await act(async () => { runtime = await import('./runtime'); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
  const click = async (node: HTMLElement | undefined | null) => { expect(node).toBeTruthy(); await act(async () => node!.click()); };
  if (caseId === 'C3') {
    expect(document.body.textContent).toContain('自动');
    await click(button('重开面板'));
    await click(button('直接重新生成'));
    await vi.waitFor(() => expect(events.some(event => event.kind === '提交结果'), JSON.stringify(events)).toBe(true));
    const result = events.find(event => event.kind === '提交结果').data.response;
    expect(result.code).toBe(200);
    expect(result.manual_evidence.task_snapshots[0].input).toMatchObject({ duration: -1, video_mode: 'extend' });
  } else if (caseId === 'C4' || caseId === 'C5') {
    expect(document.body.textContent).toContain(caseId === 'C4' ? '跟随原视频' : '不支持自动');
    await click(document.querySelector('button[title="发送"]'));
    await vi.waitFor(() => expect(events.some(event => event.kind === '提交结果'), JSON.stringify(events)).toBe(true));
    expect(events.find(event => event.kind === '提交结果').data.response.code).toBe(200);
  } else if (caseId === 'A1') {
    await click(button('打开模型配置')); await click(button('尺寸与素材'));
    const auto = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].filter(item => item.closest('label')?.textContent?.includes('允许自动或指定秒数'));
    expect(auto).toHaveLength(2);
    await click(auto[1]); await click(button('保存'));
    await vi.waitFor(() => expect(events.some(event => event.kind === '提交结果'), JSON.stringify(events)).toBe(true));
    const result = events.find(event => event.kind === '提交结果').data.response;
    expect(result.code).toBe(200);
    expect(result.data.model.features.task_types.extend.allow_auto_duration).toBeUndefined();
  } else {
    await click([...document.querySelectorAll<HTMLDivElement>('div')].find(item => item.className.includes('refCard') && item.children.length > 0));
    await click(button('从资产中选择'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const asset = document.querySelector<HTMLElement>('[aria-label="选择视频素材"]');
    if (!asset) throw new Error(document.body.innerHTML.slice(-10000));
    await click(asset);
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes('确认') || item.textContent?.includes('确定'));
    await click(confirm);
    await click(button('视频编辑')); await clickSelectOption('视频延长');
    const duration = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes('⏱'));
    await click(duration);
    const auto = document.querySelector<HTMLInputElement>('[aria-label="自动时长，由模型选择"]');
    expect(auto).not.toBeNull();
    if (!auto!.checked) await click(auto);
    const send = document.querySelector<HTMLButtonElement>('button[title*="发送"],button[aria-label*="发送"]');
    if (!send) throw new Error([...document.querySelectorAll('button')].map(item => item.outerHTML).join('\n').slice(-5000));
    await click(send);
    await vi.waitFor(() => expect(events.some(event => event.kind === '首页参数交接')).toBe(true));
    expect(events.find(event => event.kind === '首页参数交接').data).toMatchObject({ mode: 'extend', duration: -1 });
  }
  await act(async () => { runtime!.runtimeRoot.unmount(); });
  post.mockRestore();
});
