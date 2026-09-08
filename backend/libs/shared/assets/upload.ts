import { fail, ok } from "@blue-whale/contracts";
import {
  FILE_SIGNATURE_HEAD_BYTES,
  sniffFileSignature,
  type FileSignature,
  type MediaKind,
} from "./file-signature.js";
import type { AssetService } from "./assets.service.js";
import type { ProjectService } from "@lib/shared/project/project.service.js";

export type PresignAssetInput = {
  type: "image" | "video" | "audio";
  mime: string;
  size: number;
};

export type CompleteAssetInput = PresignAssetInput & {
  project_id?: string;
  storage_key: string;
  width?: number;
  height?: number;
  duration?: number;
  /** IKCNLS：落库时写入 md5，供去重查询。 */
  md5?: string;
};

/** IKCNLS：上传 md5 去重输入（presign 前判断）。 */
export type DedupAssetInput = {
  type: "image" | "video" | "audio";
  mime: string;
  size: number;
  md5: string;
  project_id?: string;
};

export interface AssetUploadStorage {
  /**
   * 取对象开头的若干字节（IKE53U）。
   *
   * 单独一个方法而不是复用 `AssetReader.read`：那个读整份对象，而这里只需要开头几十字节就能
   * 认出容器——为了校验一份 200MB 的视频而把它整个拉下来，是把一道便宜的门做成了一笔昂贵的
   * 账。适配器取不到时返回 `null`，调用方据此选择放行还是拒绝。
   */
  readHead(storageKey: string, length: number): Promise<Uint8Array | null>;
  prepareUpload(input: {
    userId: string;
    type: "image" | "video" | "audio";
    mime: string;
    keyPrefix?: string;
  }): Promise<{
    storageKey: string;
    publicUrl: string;
    uploadUrl: string;
    headers: Record<string, string>;
    expiresIn: number;
  }>;
  inspectObject(storageKey: string): Promise<{
    size: number;
    mime: string | null;
    publicUrl: string;
  } | null>;
  makePublic(storageKey: string): Promise<void>;
  /** 批量物理删除对象（quiet 模式；404 视为成功幂等）。 */
  deleteMultiObjects(storageKeys: string[]): Promise<void>;
}

/** 读取链路处理不了的图片编码。见 validateUploadInput 里的理由。 */
const UNSUPPORTED_IMAGE_MIMES = new Set(["image/svg+xml", "image/svg"]);

const MAX_BYTES = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
} as const;

function validateUploadInput(input: PresignAssetInput) {
  if (
    input.type !== "image" &&
    input.type !== "video" &&
    input.type !== "audio"
  ) {
    return fail(400, "不支持的素材类型");
  }
  if (!input.mime.startsWith(`${input.type}/`)) {
    return fail(400, "文件类型与声明类型不匹配");
  }
  // SVG 在这里就挡住，不让它进库。
  //
  // 它不是「模型读不懂」那么简单：给模型读的图要过 TOS 的 `x-tos-process`，而 TOS 对 SVG
  // **挂死**——实测 25 秒零字节返回（2026-09-05，测试站）。于是 agent 的探测既取不到字节
  // 也等不到超时，白白占住一次读取。库里 21 份用户传的 SVG 今天全在走这条路。
  //
  // 挡在上传口而不是读取时，用户在拖文件的当下就知道要换格式，而不是等到 Agent 说
  // 「素材探测失败，请重试」——那句话既不准确，重试也没有用。
  if (UNSUPPORTED_IMAGE_MIMES.has(input.mime.toLowerCase())) {
    return fail(400, "这个图片格式读不了。请用 JPG、PNG、WebP 或 GIF。");
  }
  if (
    !Number.isInteger(input.size) ||
    input.size <= 0 ||
    input.size > MAX_BYTES[input.type]
  ) {
    return fail(400, "文件大小无效或超过限制");
  }
  return null;
}

export async function handlePresignAsset(
  userId: string,
  input: PresignAssetInput,
  storage: AssetUploadStorage | null,
) {
  const invalid = validateUploadInput(input);
  if (invalid) return invalid;
  if (!storage) return fail(100202, "对象存储未配置");

  const prepared = await storage.prepareUpload({
    userId,
    type: input.type,
    mime: input.mime,
  });
  return ok({
    storage_key: prepared.storageKey,
    upload_url: prepared.uploadUrl,
    headers: prepared.headers,
    expires_in: prepared.expiresIn,
  });
}

/**
 * IKCNLS：上传 md5 去重（presign 前判断）。
 * 命中：返回该用户未删同 md5 的最优资产（toAssetResponse），并建 project_asset 关联，前端跳过 presign→PUT→complete 3 步。
 * 未命中：返回需上传标记，前端走 3 步。
 */
export async function handleDedupAsset(
  userId: string,
  input: DedupAssetInput,
  deps: {
    projects: ProjectService;
    uploads: AssetService;
  },
) {
  const invalid = validateUploadInput(input);
  if (invalid) return invalid;
  // 去重是 presign 前的 fast-path，绝不该阻断正常上传：md5 缺失/格式不标准 → 返回 {dedup:false}，
  // 前端走 presign→PUT→complete 3 步。type/mime/size 校验保持 fail-closed（presign/complete 也会校验）。
  if (!input.md5 || !/^[a-f0-9]{32}$/i.test(input.md5)) {
    return ok({ dedup: false });
  }
  const projectId = input.project_id || "0";
  if (
    projectId !== "0" &&
    !(await deps.projects.findOwnedById(projectId, userId))
  ) {
    return fail(100301, "资源不存在");
  }
  const existing = await deps.uploads.findOwnedByMd5(userId, input.md5);
  // 命中但 type 不一致（同 md5 但存储时误标类型）→ 视为未命中，避免返回错误类型资产。
  if (!existing || existing.type !== input.type) {
    // 未命中：标记需上传，前端走 presign→PUT→complete。
    return ok({ dedup: false });
  }
  // 命中：挂到目标项目（幂等），返回资产直接复用。
  if (projectId !== "0") {
    await deps.uploads.linkAssetToProject({
      userId,
      assetId: existing.id,
      projectId,
    });
  }
  return ok({ dedup: true, asset: toAssetResponse(existing) });
}

const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

/**
 * 读文件头并认它（IKE53U）。
 *
 * 两种「没结论」要分开：**读不到**和**认不出**。取字节本身失败（对象存储抖动、适配器没实现
 * 这个方法）时放行——这道门是为了挡住明显不是媒体的文件，不该因为一次网络抖动把正常上传拒掉；
 * 真的读到了字节却认不出任何容器，那才是拒绝的理由。混在一起会让一次抖动看起来像「你的文件
 * 坏了」，那是最容易让人白白重传三次的一种错话。
 */
/**
 * 拒收，并把刚写进对象存储的那份字节删掉（IKE53U）。
 *
 * **字节比这道门先落地。** 前端拿预签名地址直传对象存储，后端不在那条路上——`complete` 是
 * 它第一次有机会看见文件。所以一次被拒的上传会在桶里留下一个谁也不引用的对象：产品侧没有
 * 资产行、用户拿不到 asset_id，但字节还在，而素材 GC 至今没跑。留着它没有任何用处，正因为
 * 没有任何一行数据指向它——将来谁也认不出它是什么、能不能删。
 *
 * 删失败不影响拒收结论：用户要看到的是「这份文件不行」，不是「清理失败」。
 */
async function rejectUploadedObject(
  storage: AssetUploadStorage,
  storageKey: string,
  message: string,
) {
  try {
    await storage.deleteMultiObjects([storageKey]);
  } catch {
    // 吞掉：孤儿对象是存储成本，说错话是产品问题，后者更贵。
  }
  return fail(400, message);
}

async function readFileSignature(
  storage: AssetUploadStorage,
  storageKey: string,
): Promise<{ checked: boolean; value: FileSignature | null }> {
  let head: Uint8Array | null;
  try {
    head = await storage.readHead(storageKey, FILE_SIGNATURE_HEAD_BYTES);
  } catch {
    return { checked: false, value: null };
  }
  if (!head) return { checked: false, value: null };
  return { checked: true, value: sniffFileSignature(head) };
}

export async function handleCompleteAsset(
  userId: string,
  input: CompleteAssetInput,
  deps: {
    projects: ProjectService;
    uploads: AssetService;
    storage: AssetUploadStorage | null;
  },
) {
  const invalid = validateUploadInput(input);
  if (invalid) return invalid;
  if (!input.storage_key) return fail(400, "缺少存储键");
  const projectId = input.project_id || "0";
  if (
    projectId !== "0" &&
    !(await deps.projects.findOwnedById(projectId, userId))
  ) {
    return fail(100301, "资源不存在");
  }
  if (!input.storage_key.startsWith(`uploads/${userId}/${input.type}/`)) {
    return fail(400, "存储键与当前用户不匹配");
  }

  if (!deps.storage) return fail(100202, "对象存储未配置");
  const existing = await deps.uploads.findCommittedUpload(
    userId,
    input.storage_key,
  );
  if (existing) {
    await deps.storage.makePublic(input.storage_key);
    return ok(toAssetResponse(existing));
  }
  const object = await deps.storage.inspectObject(input.storage_key);
  if (!object) {
    return fail(400, "上传对象不存在");
  }
  if (object.size !== input.size) {
    return fail(400, "文件大小与实际上传不符");
  }
  if (
    object.mime?.split(";", 1)[0]?.trim().toLowerCase() !==
    input.mime.toLowerCase()
  ) {
    return fail(400, "文件类型与实际上传不符");
  }

  // 到这里为止校验的全是**声明值**：type、mime、size，以及对象存储上的 size 与 Content-Type
  // 是否与声明一致。而 Content-Type 正是客户端 PUT 时自己写的，两边天然自洽——一份伪造的
  // 文件把每一道都走通了。测试站 2026-09-08 的 asset_id=6012 就是这么进的库：524 字节随机
  // 数据、头四字节 AB CD EF 12、声明 image/jpeg，一路畅通，直到 Agent 读它时才发现读不了。
  //
  // 所以在这里读一次文件本身。与上面 SVG 那道门同一条理由：挡在上传口，用户在拖文件的当下
  // 就知道要换一份，而不是等一轮对话之后收到一句「素材探测失败，请重试」。
  const signature = await readFileSignature(deps.storage, input.storage_key);
  if (signature.checked && !signature.value) {
    return rejectUploadedObject(
      deps.storage,
      input.storage_key,
      "这个文件打不开，可能已损坏。请换一份 JPG、PNG、WebP 或 MP4 重新上传。",
    );
  }
  if (signature.value && signature.value.kind !== input.type) {
    // 认得出，但不是它声明的那类。按**字节**说的算——声明是别人说的。
    return rejectUploadedObject(
      deps.storage,
      input.storage_key,
      `这个文件实际是${MEDIA_KIND_LABELS[signature.value.kind]}，和你选择的类型不一致。请重新上传。`,
    );
  }

  await deps.storage.makePublic(input.storage_key);
  const asset = await deps.uploads.createUploadedAsset({
    userId,
    projectId,
    type: input.type,
    mime: input.mime,
    size: input.size,
    storageKey: input.storage_key,
    url: object.publicUrl,
    ...(input.width == null ? {} : { width: input.width }),
    ...(input.height == null ? {} : { height: input.height }),
    ...(input.duration == null ? {} : { duration: input.duration }),
    ...(input.md5 ? { md5: input.md5 } : {}),
  });

  return ok(toAssetResponse(asset));
}

function toAssetResponse(asset: {
  id: string;
  type: string;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}) {
  return {
    asset_id: asset.id,
    status: "ready" as const,
    type: asset.type,
    url: asset.url,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    duration: asset.duration,
    mime: asset.mime ?? "application/octet-stream",
    size: Number(asset.size ?? BigInt(0)),
  };
}
