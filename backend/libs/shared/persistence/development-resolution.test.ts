import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

describe("@lib/shared/persistence dist resolution", () => {
  it("resolves an executable dist build with the current AssetRepo API", () => {
    const build = spawnSync("pnpm", ["--dir", "backend", "build"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(build.status, build.stderr).toBe(0);

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
