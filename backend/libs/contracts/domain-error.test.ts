import { describe, expect, it } from "vitest";

import {
  ASSET_ERROR_SPECS,
  ERROR_CODES,
  ERROR_QUOTA_EXHAUSTED,
  RESOURCE_NOT_FOUND_CODE,
  errorCodeToNumeric,
  httpStatusForCode,
  messageOf,
} from "./error-codes.js";
import { DomainError, assetError, isDomainError } from "./domain-error.js";

describe("素材域码表（2xxx）", () => {
  const specs = Object.values(ASSET_ERROR_SPECS);

  it("码不重复——重复了就是两条错误共用一个码，前端分不开", () => {
    const codes = specs.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("全部落在 2xxx 段：段位是 result.ts 的约定，越段会被 httpStatusForCode 当成 HTTP 码", () => {
    for (const spec of specs) expect(spec.code).toBeGreaterThanOrEqual(2000);
    for (const spec of specs) expect(spec.code).toBeLessThan(3000);
  });

  it("文案在总表里，且与码表同源——手抄第二份迟早分叉", () => {
    for (const spec of specs) expect(ERROR_CODES[spec.code]).toBe(spec.message);
  });

  it("状态码都是合法的 4xx/5xx——2xx 会让拒绝看起来像成功，那正是本次要修的 bug", () => {
    for (const spec of specs) {
      expect(spec.status, `${spec.code}`).toBeGreaterThanOrEqual(400);
      expect(spec.status, `${spec.code}`).toBeLessThan(600);
    }
  });

  it("「格式不支持」和「文件打不开」是两条不同的话，不许合并", () => {
    expect(ASSET_ERROR_SPECS.ASSET_FORMAT_UNSUPPORTED.message).not.toBe(
      ASSET_ERROR_SPECS.ASSET_BYTES_UNRECOGNIZED.message,
    );
    expect(ASSET_ERROR_SPECS.ASSET_FORMAT_UNSUPPORTED.code).not.toBe(
      ASSET_ERROR_SPECS.ASSET_BYTES_UNRECOGNIZED.code,
    );
  });
});

describe("httpStatusForCode", () => {
  it("4xx/5xx 本身就是 HTTP 语义，原样用", () => {
    expect(httpStatusForCode(400)).toBe(400);
    expect(httpStatusForCode(404)).toBe(404);
    expect(httpStatusForCode(503)).toBe(503);
  });

  it("素材域码查码表", () => {
    expect(httpStatusForCode(ASSET_ERROR_SPECS.ASSET_OBJECT_MISSING.code)).toBe(404);
    expect(httpStatusForCode(ASSET_ERROR_SPECS.ASSET_STORAGE_KEY_FOREIGN.code)).toBe(403);
    expect(httpStatusForCode(ASSET_ERROR_SPECS.ASSET_STORAGE_UNCONFIGURED.code)).toBe(503);
  });

  it("全局业务码查表：资源不存在是 404，不是 400", () => {
    expect(httpStatusForCode(RESOURCE_NOT_FOUND_CODE)).toBe(404);
  });

  it("生成域的余额不足（quota_exhausted）投影成 402，不是兜底的 400", () => {
    expect(httpStatusForCode(errorCodeToNumeric(ERROR_QUOTA_EXHAUSTED))).toBe(402);
  });

  it("认不出的码兜底 400——**绝不能兜到 2xx**", () => {
    const status = httpStatusForCode(999999);
    expect(status).toBe(400);
    expect(status).toBeGreaterThanOrEqual(400);
  });
});

describe("DomainError", () => {
  it("文案默认从码表取，调用点不必自己写中文", () => {
    const error = new DomainError(RESOURCE_NOT_FOUND_CODE);
    expect(error.message).toBe(messageOf(RESOURCE_NOT_FOUND_CODE));
    expect(error.status).toBe(404);
  });

  it("assetError 一次对齐码、状态、文案", () => {
    const error = assetError("ASSET_FORMAT_UNSUPPORTED");
    expect(error.code).toBe(ASSET_ERROR_SPECS.ASSET_FORMAT_UNSUPPORTED.code);
    expect(error.status).toBe(ASSET_ERROR_SPECS.ASSET_FORMAT_UNSUPPORTED.status);
    expect(error.message).toBe(ASSET_ERROR_SPECS.ASSET_FORMAT_UNSUPPORTED.message);
  });

  it("允许覆写文案，但不允许覆写出一个 2xx 状态", () => {
    const error = new DomainError(2012, "这个文件实际是视频，和你选择的类型不一致。请重新上传。");
    expect(error.message).toContain("视频");
    expect(error.status).toBe(422);
  });

  it("是 Error，能被 instanceof 认出来——异常过滤器就靠这个分支", () => {
    expect(assetError("ASSET_SIZE_INVALID")).toBeInstanceOf(Error);
    expect(isDomainError(assetError("ASSET_SIZE_INVALID"))).toBe(true);
    expect(isDomainError(new Error("别的错"))).toBe(false);
  });
});
