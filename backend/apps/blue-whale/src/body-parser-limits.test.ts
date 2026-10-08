import type { AddressInfo } from "node:net";

import express from "express";
import { describe, expect, it } from "vitest";

function appWithMainOrder() {
  const app = express();
  app.use("/api/internal/agent-model", express.json({ limit: "64mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.post("/api/internal/agent-model/v1/chat/completions", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post("/api/anything-else", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

const bodyOf = (bytes: number) => JSON.stringify({ pad: "x".repeat(bytes) });

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
