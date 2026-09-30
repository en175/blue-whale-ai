// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountRecordsModal from './index';

const accountApi = vi.hoisted(() => ({
  fetchConsumptions: vi.fn(),
}));

vi.mock('@/api/account', () => accountApi);

let root: Root;
let mountNode: HTMLDivElement;

async function renderModal() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(AccountRecordsModal, { onClose: vi.fn() }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** 切到「消费记录」页签（账户流水）。 */
async function openConsumeTab() {
  await act(async () => {
    [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('消费记录'))
      ?.click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  accountApi.fetchConsumptions.mockResolvedValue({
    items: [
      {
        id: 'res:7',
        type: 'consume',
        direction: 'out',
        title: '视频生成 · seedance-2.5 1080p 5s',
        credits: 5,
        status: 'done',
        created_at: '2026-09-25T10:00:00+08:00',
        settled_at: '2026-09-25T10:01:00+08:00',
      },
      {
        // 进账（退款）与出账（消费）同列，方向只看 direction——billing 给的 credits
        // 一律是正幅度，按数值正负猜符号会把退回的积分显示成又扣了一笔。
        id: 'led:8',
        type: 'refund',
        direction: 'in',
        title: '退款（视频生成）',
        credits: 6,
        status: 'done',
        created_at: '2026-09-25T10:02:00+08:00',
        settled_at: '2026-09-25T10:02:10+08:00',
      },
    ],
    next_page_token: '',
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('AccountRecordsModal', () => {
  it('★ 充值记录页签拉**真实**流水（type=recharge），不是占位说明', async () => {
    // ⚠️ 这条以前断言的是相反的东西：「充值功能暂未开放 / 支付通道尚未接入」。
    //    那句话在写下时是对的，但充值 2026-09-25 就已接回，后端读面（`type=recharge`）
    //    一直是通的 —— 于是它变成了一句与事实相反的话：用户点开自己的充值记录，
    //    看到的是「暂时无法充值」。
    //
    //    测试跟着行为改，不是行为跟着测试改：这条现在断言「真的去查了充值流水」。
    await renderModal();

    expect(accountApi.fetchConsumptions).toHaveBeenCalledWith(1, 20, 'recharge');
    expect(document.body.textContent).not.toContain('暂未开放');
  });

  it('消费记录写死 type=consume，只取消费流水', async () => {
    await renderModal();
    await openConsumeTab();

    // 后端默认（不传 type）= 全部流水，会把充值/赠送混进来；标签叫消费就必须只查消费
    expect(accountApi.fetchConsumptions).toHaveBeenCalledWith(1, 20, 'consume');
    expect(document.body.textContent).toContain('视频生成 · seedance-2.5 1080p 5s');
  });

  it('按 direction 出符号：出账带 -、进账带 +', async () => {
    await renderModal();
    await openConsumeTab();

    expect(document.body.textContent).toContain('-5 积分');
    expect(document.body.textContent).toContain('+6 积分');
    expect(document.body.textContent).toContain('退款（视频生成）');
  });

  it('未结算的行标出「处理中」——它给的金额是预计消耗，不是实际扣费', async () => {
    accountApi.fetchConsumptions.mockResolvedValue({
      items: [
        {
          id: 'res:9',
          type: 'consume',
          direction: 'out',
          title: '视频生成 · seedance-2.5 1080p 5s',
          credits: 30,
          status: 'pending',
          created_at: '2026-09-25T10:03:00+08:00',
          settled_at: '',
        },
      ],
      next_page_token: 'cursor-next',
    });

    await renderModal();
    await openConsumeTab();

    expect(document.body.textContent).toContain('-30 积分');
    expect(document.body.textContent).toContain('处理中');
  });
});
