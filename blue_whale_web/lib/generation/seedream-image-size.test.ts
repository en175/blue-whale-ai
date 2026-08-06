import { describe, expect, it } from "vitest";

import {
  hasSeedreamSizeTable,
  listSeedreamSizes,
  resolveSeedreamImageSize,
} from "./seedream-image-size";

const RATIOS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
  "21:9",
] as const;

const SIZE_TABLES = {
  pro1k: [
    "1024x1024",
    "1152x864",
    "864x1152",
    "1424x800",
    "800x1424",
    "1248x832",
    "832x1248",
    "1568x672",
  ],
  pro2k: [
    "2048x2048",
    "2368x1776",
    "1776x2368",
    "2816x1584",
    "1584x2816",
    "2496x1664",
    "1664x2496",
    "3136x1344",
  ],
  standard1k: [
    "1024x1024",
    "1152x864",
    "864x1152",
    "1312x736",
    "736x1312",
    "1248x832",
    "832x1248",
    "1568x672",
  ],
  standard2k: [
    "2048x2048",
    "2304x1728",
    "1728x2304",
    "2848x1600",
    "1600x2848",
    "2496x1664",
    "1664x2496",
    "3136x1344",
  ],
  standard3k: [
    "3072x3072",
    "3456x2592",
    "2592x3456",
    "4096x2304",
    "2304x4096",
    "3744x2496",
    "2496x3744",
    "4704x2016",
  ],
  standard4k: [
    "4096x4096",
    "4704x3520",
    "3520x4704",
    "5504x3040",
    "3040x5504",
    "4992x3328",
    "3328x4992",
    "6240x2656",
  ],
} as const;

const CASES = [
  ["doubao-seedream-5-0-pro-260628", "1K", SIZE_TABLES.pro1k],
  ["doubao-seedream-5-0-pro-260628", "2K", SIZE_TABLES.pro2k],
  ["doubao-seedream-5-0-260128", "2K", SIZE_TABLES.standard2k],
  ["doubao-seedream-5-0-260128", "3K", SIZE_TABLES.standard3k],
  ["doubao-seedream-5-0-260128", "4K", SIZE_TABLES.standard4k],
  ["doubao-seedream-4-5-251128", "2K", SIZE_TABLES.standard2k],
  ["doubao-seedream-4-5-251128", "4K", SIZE_TABLES.standard4k],
  ["doubao-seedream-4-0-250828", "1K", SIZE_TABLES.standard1k],
  ["doubao-seedream-4-0-250828", "2K", SIZE_TABLES.standard2k],
  ["doubao-seedream-4-0-250828", "4K", SIZE_TABLES.standard4k],
] as const;

describe("resolveSeedreamImageSize", () => {
  it.each(
    CASES.flatMap(([model, size, dimensions]) =>
      RATIOS.map(
        (ratio, index) => [model, size, ratio, dimensions[index]] as const,
      ),
    ),
  )("%s %s %s -> %s", (model, size, ratio, expected) => {
    expect(resolveSeedreamImageSize(model, size, ratio)).toBe(expected);
  });

  it("rejects unsupported model, resolution, and ratio combinations", () => {
    expect(
      resolveSeedreamImageSize("doubao-seedream-5-0-pro-260628", "4K", "1:1"),
    ).toBeNull();
    expect(resolveSeedreamImageSize("unknown-model", "2K", "1:1")).toBeNull();
    expect(
      resolveSeedreamImageSize("doubao-seedream-5-0-260128", "2K", "5:4"),
    ).toBeNull();
  });
});

describe("hasSeedreamSizeTable", () => {
  it("只把查表族模型判为 seedream，族外模型尺寸直通", () => {
    expect(hasSeedreamSizeTable("doubao-seedream-4-0-250828")).toBe(true);
    expect(hasSeedreamSizeTable("t15-image")).toBe(false);
    expect(hasSeedreamSizeTable("unknown-model")).toBe(false);
  });
});

describe("listSeedreamSizes", () => {
  it("does not expose unsupported Seedream 5.0 Pro 4K", () => {
    expect(listSeedreamSizes("doubao-seedream-5-0-pro-260628")).toEqual([
      "1k",
      "2k",
    ]);
  });
});
