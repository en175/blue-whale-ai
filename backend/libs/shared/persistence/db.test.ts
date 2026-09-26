// 测试期库名闸门（`assertNotRealEnvironment`）的回归。
//
// 为什么值得一条测试：这批集成测试连**真 MySQL**、会给测试造数据、跑完还 `DELETE`。
// 门一旦被指到开发库就是一次静默清空 —— billing 侧为此丢过两次数据，backend 侧此前没有任何检查。
// 闸门失效的表现是**没有任何表现**（照常跑、照常删），所以必须由测试钉住。
import { afterEach, describe, expect, it } from "vitest";

import { assertNotRealEnvironment, getPrismaClient } from "./db.js";

const ORIGINAL_VITEST = process.env.VITEST;

afterEach(() => {
  if (ORIGINAL_VITEST === undefined) delete process.env.VITEST;
  else process.env.VITEST = ORIGINAL_VITEST;
});

describe("测试期库名闸门", () => {
  it("跑在测试进程里连开发库 → 拒绝", () => {
    process.env.VITEST = "true";
    expect(() =>
      assertNotRealEnvironment("mysql://root:localdev@127.0.0.1:13306/blue_whale"),
    ).toThrow(/blue_whale/);
  });

  it("blue_whale_* 这些历史变体同样拒绝（web / server / default）", () => {
    process.env.VITEST = "true";
    for (const name of ["blue_whale_web", "blue_whale_server", "blue_whale_default"]) {
      expect(() => assertNotRealEnvironment(`mysql://root:x@127.0.0.1:13306/${name}`)).toThrow();
    }
  });

  it("专用测试库放行（bw_gate_* / tz_caliber / 动态建名）", () => {
    process.env.VITEST = "true";
    for (const name of [
      "bw_gate_IKFCXC",
      "tz_caliber",
      "ikfcxc-" + "abc123",
    ]) {
      expect(() => assertNotRealEnvironment(`mysql://root:x@127.0.0.1:13306/${name}`)).not.toThrow();
    }
  });

  it("**不在测试进程里就一律放行**（产品路径不能被它挡住）", () => {
    delete process.env.VITEST;
    expect(() =>
      assertNotRealEnvironment("mysql://root:real@prod-host:3306/blue_whale"),
    ).not.toThrow();
  });

  it("★ 闸门**真的接在连接入口上**（不是只写了个没人调的函数）", () => {
    // 这条是变异检查逼出来的：只测 `assertNotRealEnvironment` 本身，
    // 把它在 `getPrismaClient` 里的调用删掉，上面几条**照样全绿**——
    // 测了函数、没测接线，等于没测。所以这里必须从**入口**打。
    process.env.VITEST = "true";
    expect(() =>
      getPrismaClient("mysql://root:x@127.0.0.1:13306/blue_whale"),
    ).toThrow(/blue_whale/);
    // ⚠️ 这条必须先抛：真环境那条路在**建客户端之前**就断了，所以不会污染同进程的客户端缓存。
  });

  it("解析不出库名时不拦（连不上会在别处炸，不该在这里误报）", () => {
    process.env.VITEST = "true";
    expect(() => assertNotRealEnvironment("not-a-url")).not.toThrow();
  });
});
