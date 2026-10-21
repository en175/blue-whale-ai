import { HttpException, HttpStatus } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { DomainError, assetError } from "@lib/contracts";
import { describe, expect, it, vi } from "vitest";

import { AllExceptionsFilter } from "./all-exceptions.filter.js";

function capture() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: "POST", url: "/api/agent/assets/uploads/presign" }),
    }),
  };
  return { json, status, host: host as never };
}

describe("AllExceptionsFilter", () => {
  const filter = new AllExceptionsFilter();

  it("DomainError：HTTP 状态与信封 code 同出码表，不再是 201", () => {
    const { json, status, host } = capture();
    filter.catch(assetError("ASSET_FORMAT_UNSUPPORTED"), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 2003,
      msg: "这个图片格式读不了。请用 JPG、PNG、WebP 或 GIF。",
      data: null,
    });
  });

  it("DomainError：状态码跟着码走，不是一律 400", () => {
    const { json, status, host } = capture();
    filter.catch(assetError("ASSET_OBJECT_MISSING"), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ code: 2007 });
  });

  it("DomainError：领域码原样进信封，不被状态码顶掉", () => {
    const { json, status, host } = capture();
    filter.catch(new DomainError(100301, "资源不存在"), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ code: 100301 });
  });

  it("NewApiError 仍按状态码投影（上游透传语义，ADR-0083 明列豁免）", () => {
    const { json, status, host } = capture();
    filter.catch(new NewApiError("会话不存在", 404, "session_not_found"), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      code: 404,
      msg: "会话不存在",
      data: null,
      error_code: "session_not_found",
    });
  });

  it("HttpException 保留自己的状态码", () => {
    const { status, host } = capture();
    filter.catch(new HttpException("参数不合法", HttpStatus.BAD_REQUEST), host);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("未知异常兜底 500，且不把内部信息说给用户", () => {
    const { json, status, host } = capture();
    filter.catch(new Error("connect ECONNREFUSED 10.0.0.3:3306"), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0]?.[0]).toEqual({ code: 500, msg: "服务器内部错误", data: null });
  });
});
