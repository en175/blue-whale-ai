// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { createLab } from './server';
import { handleCreateGenerationJob } from '../../../backend/libs/shared/generation/handle-create-generation-job';
import { parseModelUpdateBody } from '../../../backend/libs/shared/model-capability/constants';
import { toFeatures } from '../../../backend/libs/shared/persistence/model-capability-repo';

it('验收页面可操作真实面板并拿到真实接纳快照', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  const created: any[] = [];
  const lab = createLab(async () => ({ handleCreateGenerationJob, parseModelUpdateBody, toFeatures }));
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const result = await lab(init?.method ?? 'GET', new URL(input, location.origin).pathname,
      init?.body ? JSON.parse(String(init.body)) : undefined);
    if ('manual_evidence' in result.body) created.push(result.body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  }));
  await act(async () => { await import('./runtime'); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  const config = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Seedance 2.5'));
  expect(config).toBeTruthy();
  await act(async () => { config!.click(); });
  const automatic = document.querySelector<HTMLInputElement>('[aria-label="自动时长，由模型选择"]');
  expect(automatic).not.toBeNull();
  await act(async () => { automatic!.click(); });
  const send = document.querySelector<HTMLButtonElement>('button[title="发送"]');
  expect(send).not.toBeNull();
  await act(async () => { send!.click(); });
  await vi.waitFor(() => expect(created).toHaveLength(1));
  expect(created[0].code).toBe(200);
  expect(created[0].manual_evidence.task_snapshots[0].input).toMatchObject({ duration: -1, video_mode: 'extend' });
  expect(JSON.parse(localStorage.getItem('ikluvp-draft-C1')!).draftDuration).toBe(-1);
});
