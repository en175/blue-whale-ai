import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function expectBrowserBundle(entryPoint: URL) {
  const result = await build({
    entryPoints: [fileURLToPath(entryPoint)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });

  expect(result.errors).toEqual([]);
  expect(result.outputFiles).toHaveLength(1);
}

describe("Canvas placement 浏览器包边界", () => {
  it("打包 placement 时不引入 Node 内置模块", async () => {
    await expectBrowserBundle(new URL("./placement.ts", import.meta.url));
  });

  it("打包场景卡放置恢复时不引入 Node 内置模块", async () => {
    await expectBrowserBundle(
      new URL(
        "../../../lib/conversation/scene-card-placement.ts",
        import.meta.url,
      ),
    );
  });

  it("打包 contracts 浏览器入口时不引入 Node 内置模块", async () => {
    await expectBrowserBundle(
      new URL("../../../../packages/contracts/src/index.ts", import.meta.url),
    );
  });
});
