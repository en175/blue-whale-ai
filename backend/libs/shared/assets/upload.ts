import {
  ASSET_ERROR_SPECS,
  DomainError,
  RESOURCE_NOT_FOUND_CODE,
  assetError,
  ok,
} from "@lib/contracts";
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
  /** 真人人像库素材导入：写入本地资产的素材库 id（Asset- 前缀）。 */
  materialId?: string;
};

/** IKCNLS：上传 md5 去重输入（presign 前判断）。 */
export type DedupAssetInput = {
  type: "image" | "video" | "audio";
  mime: string;
  size: number;
  md5: string;
  project_id?: string;
  /** 真人人像库导入：命中已有本地资产时补绑素材库 id。 */
  materialId?: string;
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

/** 读取链路处理不了的图片编码。见 assertUploadInput 里的理由。 */
const UNSUPPORTED_IMAGE_MIMES = new Set(["image/svg+xml", "image/svg"]);

const MAX_BYTES = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
} as const;

/**
 * 校验声明值。**不合格就抛**，不再返回一个信封。
 *
 * 改抛的理由不是风格：返回的信封走不到 `AllExceptionsFilter`，没人给它写 HTTP 状态码，
 * 于是一次 POST 的拒绝回成 `HTTP 201` + 信封 `code: 400`（2026-09-08 测试站实测）。
 * 见 `contracts/domain-error.ts` 与 ADR-0083。
 */
function assertUploadInput(input: PresignAssetInput): void {
  if (
    input.type !== "image" &&
    input.type !== "video" &&
    input.type !== "audio"
  ) {
    throw assetError("ASSET_TYPE_UNSUPPORTED");
  }
  if (!input.mime.startsWith(`${input.type}/`)) {
    throw assetError("ASSET_TYPE_MIME_MISMATCH");
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
    throw assetError("ASSET_FORMAT_UNSUPPORTED");
  }
  if (
    !Number.isInteger(input.size) ||
    input.size <= 0 ||
    input.size > MAX_BYTES[input.type]
  ) {
    throw assetError("ASSET_SIZE_INVALID");
  }
}

export async function handlePresignAsset(
  userId: string,
  input: PresignAssetInput,
  storage: AssetUploadStorage | null,
) {
  assertUploadInput(input);
  if (!storage) throw assetError("ASSET_STORAGE_UNCONFIGURED");

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

/** 素材库 id（Asset- 前缀）；非法值忽略，不阻断普通上传。 */
const MATERIAL_ID_PATTERN = /^asset-.{1,128}$/i;

function readOptionalMaterialId(value: unknown): string | undefined {
  if (typeof value !== "string" || !MATERIAL_ID_PATTERN.test(value.trim())) return undefined;
  return value.trim();
}

/**
 * IKGQWR：上传口素材闸的最小接口（实现见 `@lib/shared/material/material-upload-gate.ts`）。
 *
 * 刻意用**结构类型**而不是跨域 import：`upload.ts` 属于素材资产域，不因此依赖素材库域。
 * 接线在控制器层完成（与生成门把接线放在 `material-gate-wiring.ts` 同一思路）。
 */
export interface UploadMaterialGate {
  /** 放行时给出素材组 id（允许 null，见 material-upload-gate.ts 的说明）。 */
  check(
    userId: string,
    materialId: string,
  ): Promise<
    { ok: true; materialGroupId: string | null } | { ok: false; message: string }
  >;
}

/**
 * 闸不过时的统一错误（ADR-0093 决策 3）。
 *
 * **一个码 + 两条 msg**：终局（素材未通过 / 上游已不存在）与暂时故障（上游不可达）共用
 * `ASSET_MATERIAL_UNAVAILABLE`，前端按 `msg` 分流。与生成门同款口径（ADR-0087 决策 6）——
 * 两条闸门形状必须一致，否则同一个用户在上传口和生成口拿到两套话术。
 */
function materialUnavailable(message: string): DomainError {
  return new DomainError(
    ASSET_ERROR_SPECS.ASSET_MATERIAL_UNAVAILABLE.code,
    message,
  );
}

/**
 * IKCNLS：上传 md5 去重（presign 前判断）。
 * 命中：返回该用户未删同 md5 的最优资产（toAssetResponse），并建 project_asset 关联，前端跳过 presign→PUT→complete 3 步。
 * 未命中：返回需上传标记，前端走 3 步。
 *
 * IKGQWR：带 `materialId` 时多两件事——先过素材闸，命中后再把 `material_id` /
 * `material_group_id` 写到复用的那条资产上（ADR-0093 决策 2/3）。
 */
export async function handleDedupAsset(
  userId: string,
  input: DedupAssetInput,
  deps: {
    projects: ProjectService;
    uploads: AssetService;
    /** IKGQWR：带 materialId 时的素材闸。必填——可选会让生产漏接线时静默无闸。 */
    materialGate: UploadMaterialGate;
  },
) {
  assertUploadInput(input);
  const materialId = readOptionalMaterialId(input.materialId);

  // IKGQWR：带素材库 id 时**先过闸**。这是对既有「去重是 presign 前的 fast-path，绝不该阻断
  // 正常上传」的一处**有意例外**：那句话拦的是 md5 缺失/格式不标准这类本地小毛病，而素材状态
  // 是用户明确指名要关联的对象——放行等于让一张不可用的素材悄悄变成可用的本地资产。
  const gate = materialId ? await deps.materialGate.check(userId, materialId) : null;
  if (gate !== null && !gate.ok) throw materialUnavailable(gate.message);

  const projectId = input.project_id || "0";
  if (
    projectId !== "0" &&
    !(await deps.projects.findOwnedById(projectId, userId))
  ) {
    throw new DomainError(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }

  const reusable = await findReusableAsset(
    deps.uploads,
    userId,
    input,
    materialId,
  );
  if (!reusable) {
    // 未命中：标记需上传，前端走 presign→PUT→complete。
    return ok({ dedup: false });
  }
  // 命中：挂到目标项目（幂等），返回资产直接复用。
  if (projectId !== "0") {
    await deps.uploads.linkAssetToProject({
      userId,
      assetId: reusable.id,
      projectId,
    });
  }
  if (materialId && gate?.ok) {
    await deps.uploads.bindMaterialId({
      userId,
      assetId: reusable.id,
      materialId,
      materialGroupId: gate.materialGroupId,
    });
  }
  return ok({ dedup: true, asset: toAssetResponse(reusable) });
}

/**
 * 去重的两个答案源：先 md5（IKCNLS 既有），未命中再按素材库 id 反查（IKGQWR / ADR-0093 决策 2）。
 *
 * 反查那一条不需要前端先算 md5，所以即便 md5 缺失/不标准也不该直接判「需上传」——前端已经
 * 点名了素材，反查是零成本的一次查询，查得到就省一整轮 presign→PUT→complete。
 * 两条都必须 type 一致：同 md5 但存储时误标类型的老问题，反查这边同样成立。
 */
async function findReusableAsset(
  uploads: AssetService,
  userId: string,
  input: DedupAssetInput,
  materialId: string | undefined,
) {
  if (typeof input.md5 === "string" && /^[a-f0-9]{32}$/i.test(input.md5)) {
    const byMd5 = await uploads.findOwnedByMd5(userId, input.md5);
    if (byMd5 && byMd5.type === input.type) return byMd5;
  }
  if (materialId) {
    const byMaterial = await uploads.findOwnedByMaterialId(userId, materialId);
    if (byMaterial && byMaterial.type === input.type) return byMaterial;
  }
  return null;
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
  error: DomainError,
): Promise<never> {
  try {
    await storage.deleteMultiObjects([storageKey]);
  } catch {
    // 吞掉：孤儿对象是存储成本，说错话是产品问题，后者更贵。
  }
  throw error;
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
    /** IKGQWR：带 materialId 时的素材闸。必填——可选会让生产漏接线时静默无闸。 */
    materialGate: UploadMaterialGate;
  },
) {
  assertUploadInput(input);
  if (!input.storage_key) throw assetError("ASSET_STORAGE_KEY_MISSING");
  const projectId = input.project_id || "0";
  if (
    projectId !== "0" &&
    !(await deps.projects.findOwnedById(projectId, userId))
  ) {
    throw new DomainError(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }
  // IKGQWR：归属校验提到素材反查之前（!726 把它放在反查之后）。反查不碰对象存储，提前没有
  // 功能损失，但「先证明这个 key 是你的，再谈别的」让越权请求尽早失败。
  if (!input.storage_key.startsWith(`uploads/${userId}/${input.type}/`)) {
    throw assetError("ASSET_STORAGE_KEY_FOREIGN");
  }
  if (!deps.storage) throw assetError("ASSET_STORAGE_UNCONFIGURED");

  const materialId = readOptionalMaterialId(input.materialId);

  // 幂等重放：这个 key 已经完成过 → 原样返回，**不重新过闸**。
  // 与 ADR-0087 决策 7「门落在幂等重放命中之后」同一理由：一次重放不该按此刻的素材状态改写
  // 既有结果。这里更要紧的是——重放命中时若因闸不过去删对象，删的正是既有资产行引用的那一份。
  // 闸通过时补写关联是幂等的，照做（顺手补上 !726 时代留下的空 group 列）。
  const existing = await deps.uploads.findCommittedUpload(
    userId,
    input.storage_key,
  );
  if (existing) {
    await deps.storage.makePublic(input.storage_key);
    if (materialId) {
      const replayGate = await deps.materialGate.check(userId, materialId);
      if (replayGate.ok) {
        await deps.uploads.bindMaterialId({
          userId,
          assetId: existing.id,
          materialId,
          materialGroupId: replayGate.materialGroupId,
        });
      }
    }
    return ok(toAssetResponse(existing));
  }

  // IKGQWR（ADR-0093 决策 3/4）：过了幂等这一关，说明这个 key 还没有任何行指向它——
  // 此时闸不过就删字节是安全的。
  const gate = materialId
    ? await deps.materialGate.check(userId, materialId)
    : null;
  if (gate !== null && !gate.ok) {
    // 闸不过 → **拒绝且不落任何本地痕迹**（2026-09-18 修正；原稿写的是「建行但不关联」，
    // 那会留下一个前端拿不到 id、谁也引用不到的孤儿行，比孤儿对象更脏）。
    // 字节已经在桶里了（complete 是后端第一次看见文件），按既有拒收惯例顺手删掉——
    // rejectUploadedObject 的理由原文：「留着它没有任何用处，正因为没有任何一行数据指向它」。
    return rejectUploadedObject(
      deps.storage,
      input.storage_key,
      materialUnavailable(gate.message),
    );
  }

  // IKGQWR / !726：本地已有这张素材对应的资产 → 免建新行直接复用（反查零成本，省一行一对象）。
  // 既然复用别人，这份刚 PUT 上来的字节就没有任何行指向它，顺手回收（仅当它不是那行的对象）。
  if (materialId && gate?.ok) {
    const bound = await deps.uploads.findOwnedByMaterialId(userId, materialId);
    if (bound) {
      if (bound.storage_key !== input.storage_key) {
        await deps.storage
          .deleteMultiObjects([input.storage_key])
          .catch(() => undefined);
      }
      if (projectId !== "0") {
        await deps.uploads.linkAssetToProject({
          userId,
          assetId: bound.id,
          projectId,
        });
      }
      await deps.uploads.bindMaterialId({
        userId,
        assetId: bound.id,
        materialId,
        materialGroupId: gate.materialGroupId,
      });
      return ok(toAssetResponse(bound));
    }
  }
  const object = await deps.storage.inspectObject(input.storage_key);
  if (!object) {
    throw assetError("ASSET_OBJECT_MISSING");
  }
  if (object.size !== input.size) {
    throw assetError("ASSET_SIZE_MISMATCH");
  }
  if (
    object.mime?.split(";", 1)[0]?.trim().toLowerCase() !==
    input.mime.toLowerCase()
  ) {
    throw assetError("ASSET_MIME_MISMATCH");
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
      assetError("ASSET_BYTES_UNRECOGNIZED"),
    );
  }
  if (signature.value && signature.value.kind !== input.type) {
    // 认得出，但不是它声明的那类。按**字节**说的算——声明是别人说的。
    return rejectUploadedObject(
      deps.storage,
      input.storage_key,
      new DomainError(
        ASSET_ERROR_SPECS.ASSET_KIND_MISMATCH.code,
        `这个文件实际是${MEDIA_KIND_LABELS[signature.value.kind]}，和你选择的类型不一致。请重新上传。`,
      ),
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
    ...(materialId ? { materialId } : {}),
    // IKGQWR：组 id 与素材 id 成对写入（ADR-0093 决策 2）。闸不过时走不到这里。
    ...(materialId && gate?.ok
      ? { materialGroupId: gate.materialGroupId }
      : {}),
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
