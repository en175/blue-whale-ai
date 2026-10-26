import {
  ERROR_INVALID_REFERENCE,
  ERROR_INVALID_REFERENCE_TYPE,
} from "@lib/contracts";

export type MaterialReference = {
  id: string;
  type: "image" | "video" | "audio";
};

export class VideoInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VideoInputError";
  }
}

function readAssetId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
  if (value === undefined || value === null) return null;
  throw new VideoInputError(ERROR_INVALID_REFERENCE, "视频素材 ID 无效");
}

function readAssetIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new VideoInputError(ERROR_INVALID_REFERENCE, "视频参考素材无效");
  }
  return value.map((candidate) => {
    const id = readAssetId(candidate);
    if (id === null) {
      throw new VideoInputError(ERROR_INVALID_REFERENCE, "视频参考素材 ID 无效");
    }
    return id;
  });
}

function uniqueAssetIds(ids: Array<string | null>): string[] {
  return ids.reduce<string[]>((result, id) => {
    if (id && !result.includes(id)) result.push(id);
    return result;
  }, []);
}

const MATERIAL_ID_PATTERN = /^[Aa]sset-.{1,128}$/;

function readMaterialId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && MATERIAL_ID_PATTERN.test(value)) return value;
  throw new VideoInputError(ERROR_INVALID_REFERENCE, "素材库引用 ID 无效");
}

function readMaterialRefs(value: unknown): MaterialReference[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new VideoInputError(ERROR_INVALID_REFERENCE, "素材库参考素材无效");
  }
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new VideoInputError(ERROR_INVALID_REFERENCE, "素材库参考素材无效");
    }
    const { id, type } = candidate as { id?: unknown; type?: unknown };
    const materialId = readMaterialId(id);
    if (materialId === null) {
      throw new VideoInputError(ERROR_INVALID_REFERENCE, "素材库引用 ID 无效");
    }
    if (type !== "image" && type !== "video" && type !== "audio") {
      throw new VideoInputError(ERROR_INVALID_REFERENCE_TYPE, "素材库参考素材类型无效");
    }
    return { id: materialId, type };
  });
}

function uniqueMaterialRefs(refs: MaterialReference[]): MaterialReference[] {
  return refs.reduce<MaterialReference[]>((result, ref) => {
    if (!result.some((r) => r.id === ref.id)) result.push(ref);
    return result;
  }, []);
}

export {
  readAssetId,
  readAssetIds,
  readMaterialId,
  readMaterialRefs,
  uniqueAssetIds,
  uniqueMaterialRefs,
};
