import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLLECT_TOKEN_ENV,
  readCollectToken,
  warnIfCollectTokenMissing,
} from "./collect-token.js";

describe("代收凭证", () => {
  afterEach(() => {
    delete process.env[COLLECT_TOKEN_ENV];
  });

  it("未配置或空白时读不到钥", () => {
    expect(readCollectToken({})).toBeNull();
    expect(readCollectToken({ [COLLECT_TOKEN_ENV]: "  " })).toBeNull();
  });

  it("读到去空白后的钥", () => {
    expect(readCollectToken({ [COLLECT_TOKEN_ENV]: " secret " })).toBe("secret");
  });

  it("启动时未配置则打「未配置，可能无法下单」", () => {
    const log = { warn: vi.fn() };
    warnIfCollectTokenMissing(log, {});
    expect(log.warn).toHaveBeenCalledWith(
      "BLUE_WHALE_TOPUP_COLLECT_TOKEN 未配置，可能无法下单",
    );
  });

  it("已配置则不打启动警告", () => {
    const log = { warn: vi.fn() };
    warnIfCollectTokenMissing(log, { [COLLECT_TOKEN_ENV]: "secret" });
    expect(log.warn).not.toHaveBeenCalled();
  });
});
