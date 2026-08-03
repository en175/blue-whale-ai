// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getRechargeRecords: vi.fn(),
  getConsumptionRecords: vi.fn(),
}));

vi.mock("@/lib/api/account-records", () => ({
  getRechargeRecords: mocks.getRechargeRecords,
  getConsumptionRecords: mocks.getConsumptionRecords,
}));

import { AccountRecordsModal } from "./AccountRecordsModal";

expect.extend(jestDomMatchers);

const NOW_SEC = Math.floor(Date.now() / 1000);

const RECHARGE_ITEMS = [
  {
    trade_no: "BWP1",
    credits: 500,
    amount_cny: 42.5,
    payment_method: "微信",
    status: "success",
    created_at: NOW_SEC - 53 * 60,
  },
  {
    trade_no: "BWP2",
    credits: 100,
    amount_cny: 10,
    payment_method: "支付宝",
    status: "failed",
    created_at: NOW_SEC - 2 * 86400,
  },
  {
    trade_no: "BWP3",
    credits: 200,
    amount_cny: 18,
    payment_method: "微信",
    status: "pending",
    created_at: NOW_SEC - 3 * 86400,
  },
];

const CONSUMPTION_ITEMS = [
  {
    id: 1,
    credits: 12,
    summary: "生成图片",
    created_at: NOW_SEC - 34 * 60,
  },
  {
    id: 2,
    credits: 20,
    summary: "生成视频",
    created_at: NOW_SEC - 3600,
  },
];

describe("AccountRecordsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRechargeRecords.mockResolvedValue({
      items: RECHARGE_ITEMS,
      total: 3,
    });
    mocks.getConsumptionRecords.mockResolvedValue({
      items: CONSUMPTION_ITEMS,
      total: 2,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("打开即拉充值记录并展示积分/实付/支付方式/三态徽标/相对时间", async () => {
    render(<AccountRecordsModal onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("+500 积分")).toBeInTheDocument();
    });
    expect(mocks.getRechargeRecords).toHaveBeenCalledWith(1, 20);

    expect(screen.getByText("¥42.50 微信")).toBeInTheDocument();
    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("53分钟前")).toBeInTheDocument();
    // 消费记录此时不应预载
    expect(mocks.getConsumptionRecords).not.toHaveBeenCalled();
  });

  it("切到消费记录 Tab 才拉取，展示消耗积分与摘要", async () => {
    render(<AccountRecordsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("+500 积分")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: /消费记录/ }));

    await waitFor(() => {
      expect(screen.getByText("-12 积分")).toBeInTheDocument();
    });
    expect(screen.getByText("生成图片")).toBeInTheDocument();
    expect(screen.getByText("生成视频")).toBeInTheDocument();
    expect(screen.getByText("34分钟前")).toBeInTheDocument();
  });

  it("空列表展示空态文案", async () => {
    mocks.getRechargeRecords.mockResolvedValue({ items: [], total: 0 });
    mocks.getConsumptionRecords.mockResolvedValue({ items: [], total: 0 });
    render(<AccountRecordsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("暂无充值记录")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: /消费记录/ }));
    await waitFor(() => {
      expect(screen.getByText("暂无消费记录")).toBeInTheDocument();
    });
  });

  it("加载失败展示错误与重试；重试成功后恢复", async () => {
    mocks.getRechargeRecords.mockRejectedValueOnce(new Error("网络异常"));
    render(<AccountRecordsModal onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("网络异常")).toBeInTheDocument();
    });

    mocks.getRechargeRecords.mockResolvedValueOnce({
      items: RECHARGE_ITEMS,
      total: 3,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => {
      expect(screen.getByText("+500 积分")).toBeInTheDocument();
    });
  });

  it("点击关闭触发 onClose", async () => {
    const onClose = vi.fn();
    render(<AccountRecordsModal onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("+500 积分")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭账户记录" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
