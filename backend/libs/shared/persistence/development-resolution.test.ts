import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

// `@lib/*` 是 backend/tsconfig.json 的编译期 paths 别名，Node ESM 解析器不认识它；
// tsc-alias 在构建期把 dist 里所有 `@lib/*` 改写为相对路径。因此这里直接验证
// 编译产物 `backend/dist/libs/shared/persistence/index.js` 可作为入口被 import，
// 并暴露消费者依赖的 AssetRepo API —— 等价于旧 `@blue-whale/persistence` 包的
// "development resolution" 断言目标（dist 可执行 + API 形状）。
describe("@lib/shared/persistence dist resolution", () => {
  it("resolves an executable dist build with the current AssetRepo API", () => {
    const distIndex = resolve(
      process.cwd(),
      "backend/dist/libs/shared/persistence/index.js",
    );
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          "const url = process.argv[1];",
          "const { createAssetRepo } = await import(url);",
          "const repo = createAssetRepo({});",
          "console.log(JSON.stringify({ url, methods: [typeof repo.findCommittedUpload, typeof repo.createUploadedAsset] }));",
        ].join("\n"),
        pathToFileURL(distIndex).href,
      ],
      {
        cwd: resolve(process.cwd(), "backend"),
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      url: pathToFileURL(distIndex).href,
      methods: ["function", "function"],
    });
  });
});
