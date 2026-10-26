import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSettingsController } from "./settings.controller.js";


function createController() {
  const settings = {
    read: vi.fn().mockResolvedValue({
      credentials: {
        hccb_mch_no: "",
        hccb_app_id: "",
        hccb_app_secret: "",
        hccb_notify_url: "",
      },
      upstream: { new_api_key: "****1234" },
      policy: { refund_text: "", invoice_text: "" },
      rateLimit: { rate_per_min: 0, rate_per_hour: 0, concurrent: 0, burst: 0 },
      watermark: { enabled: false },
    }),
    update: vi.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new AdminSettingsController(settings as never),
    settings,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminSettingsController", () => {
  it("GET 返回全部模块（凭证类字段为服务端脱敏值）", async () => {
    const { controller } = createController();

    await expect(controller.read()).resolves.toMatchObject({
      success: true,
      data: { upstream: { new_api_key: "****1234" } },
    });
  });

  it("★ PUT upstream.new_api_key → 透传给 service（全项目共用这一把）", async () => {
    const { controller, settings } = createController();

    await expect(
      controller.update({ upstream: { new_api_key: "sk-fake-key" } }),
    ).resolves.toEqual({ success: true, data: null });
    expect(settings.update).toHaveBeenCalledWith({
      upstream: { new_api_key: "sk-fake-key" },
    });
  });

  it("★ 拼错的字段名 → 400，不静默存下（「配了但没生效」的源头）", async () => {
    const { controller, settings } = createController();

    await expect(
      controller.update({ upstream: { new_api_keys: "sk-fake-key" } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it("未知模块 → 400", async () => {
    const { controller } = createController();
    await expect(
      controller.update({ upstreamKey: { new_api_key: "x" } }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("★ 水印开关：true/false 透传", async () => {
    const { controller, settings } = createController();

    await controller.update({ watermark: { enabled: true } });
    expect(settings.update).toHaveBeenLastCalledWith({ watermark: { enabled: true } });

    await controller.update({ watermark: { enabled: false } });
    expect(settings.update).toHaveBeenLastCalledWith({ watermark: { enabled: false } });
  });

  it("水印开关：非布尔值 → 400，不静默存下", async () => {
    const { controller, settings } = createController();

    await expect(
      controller.update({ watermark: { enabled: "true" } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(settings.update).not.toHaveBeenCalled();
  });

  it("水印开关：拼错的字段 → 400", async () => {
    const { controller } = createController();

    await expect(
      controller.update({ watermark: { enable: true } }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("值不是字符串 → 400（数字/对象混进来会在解封后被当成空）", async () => {
    const { controller } = createController();
    await expect(controller.update({ upstream: { new_api_key: 123 } })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("只提交 upstream 时不动别的模块", async () => {
    const { controller, settings } = createController();

    await controller.update({ upstream: { new_api_key: "sk-fake-key" } });

    expect(settings.update).toHaveBeenCalledTimes(1);
    expect(settings.update.mock.calls[0]![0]).not.toHaveProperty("credentials");
    expect(settings.update.mock.calls[0]![0]).not.toHaveProperty("rateLimit");
  });

  it("body 缺省（无 body）不报错，等于什么都没改", async () => {
    const { controller, settings } = createController();
    await expect(controller.update({})).resolves.toEqual({ success: true, data: null });
    expect(settings.update).toHaveBeenCalledWith({});
  });
});
