import type { AddressInfo } from "node:net";

import express from "express";
import { describe, expect, it } from "vitest";

/**
 * body 上限按路由分档（IKAZBP）。
 *
 * 这组用例存在的理由很具体：`main.ts` 里给 `/api/internal/agent-model` 放开的 64MB **曾经是
 * 死代码**，而且带着一段解释它为什么有效的注释，写了很久没人发现。原因是当时用
 * `app.useBodyParser("json", { limit: "1mb" })` 装全局解析器——它不是「后注册就后跑」，
 * NestJS 在 `init()` 时把它装到用户中间件之前，于是路由级那个永远拿不到未消费的流。
 *
 * 表现是：agent 读一张 8MB 的图，请求体约 11MB，在 body-parser 就被
 * `PayloadTooLargeError` 挡下，用户看到的是「读不到图」，而日志里那行 64MB 一直在。
 *
 * 所以断言的不是「配置里写了什么」，而是**同一个请求体在两条路由上的实际命运**——这是唯一
 * 能把「注册顺序被改动」抓出来的形式。这里复刻 main.ts 的注册顺序而不是启动整个 Nest 应用：
 * 要守的正是这几行 `app.use` 的相对次序，把它单独拿出来测才使它成为一件被锁住的事。
 */
function appWithMainOrder() {
  const app = express();
  // ↓↓↓ 必须与 main.ts 的注册顺序一致 ↓↓↓
  app.use("/api/internal/agent-model", express.json({ limit: "64mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  // ↑↑↑ 必须与 main.ts 的注册顺序一致 ↑↑↑
  app.post("/api/internal/agent-model/v1/chat/completions", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post("/api/anything-else", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

/** 造一个指定大小的合法 JSON 体。 */
const bodyOf = (bytes: number) => JSON.stringify({ pad: "x".repeat(bytes) });

/**
 * 起真实 HTTP 服务再打过去，而不是用 supertest：不为一条回归测引一个新依赖，而且
 * body 上限这件事本来就发生在 socket 与解析器之间，走真实请求才算数。
 */
async function post(app: express.Express, path: string, body: string): Promise<number> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return response.status;
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe("body 上限按路由分档", () => {
  it("agent-model 收得下 8MB 的图编码后的体积", async () => {
    // 8.27MB 的 PNG base64 内联之后约 11MB，正是线上那次失败的量级。
    const status = await post(
      appWithMainOrder(),
      "/api/internal/agent-model/v1/chat/completions",
      bodyOf(11 * 1024 * 1024),
    );
    expect(status).toBe(200);
  });

  it("其余端点仍守在 1MB——放开的是一条内部路由，不是全局", async () => {
    const status = await post(appWithMainOrder(), "/api/anything-else", bodyOf(2 * 1024 * 1024));
    expect(status).toBe(413);
  });

  it("先装全局解析器就会把路由级那档吃掉——这正是本单修的那个顺序", async () => {
    // 反向复刻：顺序一颠倒，64MB 那档立刻失效。有了这条，下次有人「顺手整理」中间件顺序时
    // 会红，而不是等到用户传一张大图才发现。
    const wrong = express();
    wrong.use(express.json({ limit: "1mb" }));
    wrong.use("/api/internal/agent-model", express.json({ limit: "64mb" }));
    wrong.post("/api/internal/agent-model/v1/chat/completions", (_req, res) =>
      res.status(200).json({ ok: true }),
    );
    const status = await post(
      wrong,
      "/api/internal/agent-model/v1/chat/completions",
      bodyOf(2 * 1024 * 1024),
    );
    expect(status).toBe(413);
  });
});
