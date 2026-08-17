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

type Ratio = (typeof RATIOS)[number];
type SizeTable = Readonly<Record<Ratio, string>>;

function sizeTable(values: readonly string[]): SizeTable {
  return Object.fromEntries(
    RATIOS.map((ratio, index) => [ratio, values[index]]),
  ) as Record<Ratio, string>;
}

const PRO_1K = sizeTable([
  "1024x1024",
  "1152x864",
  "864x1152",
  "1424x800",
  "800x1424",
  "1248x832",
  "832x1248",
  "1568x672",
]);

const PRO_2K = sizeTable([
  "2048x2048",
  "2368x1776",
  "1776x2368",
  "2816x1584",
  "1584x2816",
  "2496x1664",
  "1664x2496",
  "3136x1344",
]);

const STANDARD_1K = sizeTable([
  "1024x1024",
  "1152x864",
  "864x1152",
  "1312x736",
  "736x1312",
  "1248x832",
  "832x1248",
  "1568x672",
]);

const STANDARD_2K = sizeTable([
  "2048x2048",
  "2304x1728",
  "1728x2304",
  "2848x1600",
  "1600x2848",
  "2496x1664",
  "1664x2496",
  "3136x1344",
]);

const STANDARD_3K = sizeTable([
  "3072x3072",
  "3456x2592",
  "2592x3456",
  "4096x2304",
  "2304x4096",
  "3744x2496",
  "2496x3744",
  "4704x2016",
]);

const STANDARD_4K = sizeTable([
  "4096x4096",
  "4704x3520",
  "3520x4704",
  "5504x3040",
  "3040x5504",
  "4992x3328",
  "3328x4992",
  "6240x2656",
]);

const MODEL_SIZES: Readonly<
  Record<string, Readonly<Record<string, SizeTable>>>
> = {
  "doubao-seedream-5-0-pro-260628": {
    "1K": PRO_1K,
    "2K": PRO_2K,
  },
  "doubao-seedream-5-0-260128": {
    "2K": STANDARD_2K,
    "3K": STANDARD_3K,
    "4K": STANDARD_4K,
  },
  "doubao-seedream-4-5-251128": {
    "2K": STANDARD_2K,
    "4K": STANDARD_4K,
  },
  "doubao-seedream-4-0-250828": {
    "1K": STANDARD_1K,
    "2K": STANDARD_2K,
    "4K": STANDARD_4K,
  },
};

export function resolveSeedreamImageSize(
  modelId: string,
  resolution: string,
  ratio: string,
): string | null {
  const table = MODEL_SIZES[modelId]?.[resolution.toUpperCase()];
  return table?.[ratio as Ratio] ?? null;
}

/** 模型是否在 seedream 分辨率查表族内；族外模型尺寸直通能力行 api_value。 */
export function hasSeedreamSizeTable(modelId: string): boolean {
  return MODEL_SIZES[modelId] !== undefined;
}

export function listSeedreamSizes(modelId: string): string[] {
  return Object.keys(MODEL_SIZES[modelId] ?? {}).map((size) =>
    size.toLowerCase(),
  );
}
