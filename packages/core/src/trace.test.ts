import { describe, expect, it } from "vitest";

import {
  TRACE_ID_PATTERN,
  generateTraceId,
  getCurrentRequestContext,
  getCurrentTraceId,
  requestAddressFields,
  resolveTraceId,
  runWithRequestContext,
  runWithTraceId,
  sanitizeAddress,
} from "./trace.js";

describe("resolveTraceId —— 透传优先、缺省生成、被拒留痕（D6）", () => {
  it("合规入参原样透传", () => {
    expect(resolveTraceId("trace-from-upstream")).toEqual({
      traceId: "trace-from-upstream",
    });
  });

  it("两端空白 trim 后判定", () => {
    expect(resolveTraceId("  abc-12345  ")).toEqual({ traceId: "abc-12345" });
  });

  it("缺省/空串/纯空白时生成，且不记 client_trace_id", () => {
    for (const value of [undefined, null, "", "   "]) {
      const resolved = resolveTraceId(value);
      expect(resolved.traceId).toMatch(TRACE_ID_PATTERN);
      expect(resolved.clientTraceId).toBeUndefined();
    }
  });

  it("旧规则放行的脏值现在一律拒收，但原值留在 client_trace_id", () => {
    // 旧规则是「长度 ≤256 的可见 ASCII」——空格、引号、路径全都进得来，而这是每一条
    // 跨服务查询的键。拒收不等于丢线索。
    for (const dirty of [
      "链路a",
      "a\nb",
      "has space",
      'quote"inside',
      "短",
      "x".repeat(65),
    ]) {
      const resolved = resolveTraceId(dirty);
      expect(resolved.traceId).toMatch(TRACE_ID_PATTERN);
      expect(resolved.clientTraceId).toBe(dirty.trim());
    }
  });

  it("没有 X-Trace-Id 时认 traceparent（D4 的廉价保险）", () => {
    expect(
      resolveTraceId(
        null,
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      ),
    ).toEqual({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736" });
  });

  it("X-Trace-Id 发了但不合规，不落到 traceparent", () => {
    // 两个头都发、第一个写错的调用方，应该看到一个明确是新生成的 id，
    // 而不是被悄悄换到另一条链上。
    const resolved = resolveTraceId(
      "bad id",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
    expect(resolved.traceId).not.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(resolved.clientTraceId).toBe("bad id");
  });

  it("生成的值满足自己强制的规则", () => {
    // 自己生成的值过不了自己的校验，是这类改动最容易犯又最难发现的错。
    expect(generateTraceId()).toMatch(TRACE_ID_PATTERN);
    expect(generateTraceId()).not.toBe(generateTraceId());
  });
});

describe("runWithTraceId —— 异步上下文传播", () => {
  it("上下文内同步/异步均可读到，上下文外为空", async () => {
    expect(getCurrentTraceId()).toBeNull();
    await runWithTraceId("trace-ctx", async () => {
      expect(getCurrentTraceId()).toBe("trace-ctx");
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getCurrentTraceId()).toBe("trace-ctx");
    });
    expect(getCurrentTraceId()).toBeNull();
  });

  it("嵌套上下文内层覆盖、外层恢复", () => {
    runWithTraceId("outer", () => {
      runWithTraceId("inner", () => {
        expect(getCurrentTraceId()).toBe("inner");
      });
      expect(getCurrentTraceId()).toBe("outer");
    });
  });
});

describe("调用方地址（IKB29O 验收：错误场景能看到是哪个 IP）", () => {
  it("剥掉 Node 在双栈 socket 上加的 IPv4 映射前缀", () => {
    expect(sanitizeAddress("::ffff:10.0.1.7")).toBe("10.0.1.7");
    expect(sanitizeAddress("10.0.1.7")).toBe("10.0.1.7");
  });

  it("不是地址就丢掉，而不是当作事实写进去", () => {
    // 有人读到 client_address 时会当它是事实；X-Forwarded-For 是客户端可控输入。
    expect(sanitizeAddress("not an ip; DROP TABLE")).toBe("");
    expect(sanitizeAddress("x".repeat(200))).toBe("");
    expect(sanitizeAddress(undefined)).toBe("");
  });

  it("整个请求处理链都拿得到上下文", async () => {
    await runWithRequestContext(
      { traceId: "t", clientAddress: "203.0.113.9", peerAddress: "10.0.0.1" },
      async () => {
        await Promise.resolve();
        expect(getCurrentRequestContext()).toEqual({
          traceId: "t",
          clientAddress: "203.0.113.9",
          peerAddress: "10.0.0.1",
        });
      },
    );
  });

  it("取不到就不写这个键", () => {
    expect(
      requestAddressFields({
        traceId: "t",
        clientAddress: "",
        peerAddress: "",
      }),
    ).toEqual({});
    expect(requestAddressFields(null)).toEqual({});
  });

  it("runWithTraceId 换 trace 时继承地址，不清空", () => {
    runWithRequestContext(
      {
        traceId: "outer",
        clientAddress: "203.0.113.9",
        peerAddress: "10.0.0.1",
      },
      () => {
        runWithTraceId("inner", () => {
          expect(getCurrentRequestContext()).toEqual({
            traceId: "inner",
            clientAddress: "203.0.113.9",
            peerAddress: "10.0.0.1",
          });
        });
      },
    );
  });

  it("getCurrentTraceId 在请求之外仍是 null", () => {
    expect(getCurrentTraceId()).toBeNull();
  });
});
