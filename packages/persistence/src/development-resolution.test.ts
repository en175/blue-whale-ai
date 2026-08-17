import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

describe("@blue-whale/persistence development resolution", () => {
  it("resolves an executable dist build with the current AssetRepo API", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--input-type=module",
        "--eval",
        [
          "const url = import.meta.resolve('@blue-whale/persistence');",
          "const { createAssetRepo } = await import(url);",
          "const repo = createAssetRepo({});",
          "console.log(JSON.stringify({ url, methods: [typeof repo.findCommittedUpload, typeof repo.createUploadedAsset] }));",
        ].join("\n"),
      ],
      {
        cwd: resolve(process.cwd(), "backend"),
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      url: pathToFileURL(
        resolve(process.cwd(), "packages/persistence/dist/index.js"),
      ).href,
      methods: ["function", "function"],
    });
  });
});
