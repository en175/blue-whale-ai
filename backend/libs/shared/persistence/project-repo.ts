import type { PrismaClient } from "@prisma/client";

/** Project CRUD 的 db port（Prisma-backed）。
 * 普通项目接口只暴露 purpose=canvas；GenerationInbox 由专用 repo 管理。 */

export interface ProjectView {
  id: string;
  name: string;
  thumb: string | null;
  /** 本项目画布上还挂着的最近 3 张 image URL（可用素材 ∩ nodes_json；按 gmt_create 倒序）。不足 3 张为实际张数，无图为空数组。 */
  previews: string[];
  created_at: string;
  /** 上次打开时间（进入画布时服务端记录，IKH1YI）；从未打开为 null。 */
  last_opened_at: string | null;
  /** 置顶时间（IKH1YI）；非空即已置顶，置顶组内按此倒序；未置顶为 null。 */
  pinned_at: string | null;
}

/** 对齐 GET /api/assets 分页壳：{ records, total, size, current }。 */
export interface ProjectPage {
  records: ProjectView[];
  total: number;
  size: number;
  current: number;
}

export interface ProjectRepo {
  listByOwner(ownerId: string): Promise<ProjectView[]>;
  /** 当前用户 canvas 项目分页；过滤条件与 listByOwner 相同。 */
  listByOwnerPaged(
    ownerId: string,
    page: number,
    size: number,
  ): Promise<ProjectPage>;
  create(ownerId: string, name: string): Promise<ProjectView>;
  findOwnedById(id: string, ownerId: string): Promise<ProjectView | null>;
  /**
   * 按项目号解出主人（New API 用户号），不要求调用方先知道主人是谁。
   * 计费归属专用：模型网关拿 Agent 声明的项目号来这里换计费主体，Agent 因此无法自报记谁的账。
   * 逻辑删除的项目返回 null——已删项目不该再产生花费。
   */
  findOwnerId(id: string): Promise<string | null>;
  rename(
    id: string,
    ownerId: string,
    name: string,
  ): Promise<ProjectView | null>;
  /** 记一笔「上次打开」（IKH1YI）：last_opened_at 置当前时间；非本人/不存在返回 false。 */
  touchLastOpened(id: string, ownerId: string): Promise<boolean>;
  /** 置顶/取消置顶（IKH1YI）：pinned=true 写当前时间，false 清空；成功回读投影，非本人/不存在返回 null。 */
  setPinned(
    id: string,
    ownerId: string,
    pinned: boolean,
  ): Promise<ProjectView | null>;
  delete(id: string, ownerId: string): Promise<boolean>;
  batchDelete(
    ownerId: string,
    ids: string[],
  ): Promise<{ succeeded: string[]; failed: string[] }>;
}

function toView(row: {
  id: bigint;
  name: string;
  thumb: string | null;
  gmt_create: Date;
  last_opened_at: Date | null;
  pinned_at: Date | null;
}): ProjectView {
  return {
    id: row.id.toString(),
    name: row.name,
    thumb: row.thumb,
    previews: [],
    created_at: row.gmt_create.toISOString(),
    last_opened_at: row.last_opened_at?.toISOString() ?? null,
    pinned_at: row.pinned_at?.toISOString() ?? null,
  };
}

/** 空名创建时使用当前日期时间作为默认项目名（PRD E5）。 */
function defaultProjectName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

const NON_IMAGE_MEDIA = new Set(["video", "audio"]);

function readId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.startsWith("blob:")) return null;
  return value;
}

/** 从 canvas.nodes_json 收 image 的 assetId / src，跳过 video/audio 与未启用的商品图。 */
function collectCanvasImageRefs(nodes: unknown): { ids: Set<string>; urls: Set<string> } {
  const ids = new Set<string>();
  const urls = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    if (rec.enabled === false) return;
    const mediaType = rec.mediaType ?? rec.media_type ?? rec.type;
    if (typeof mediaType === "string" && NON_IMAGE_MEDIA.has(mediaType)) return;
    for (const key of ["assetId", "asset_id", "assetID"] as const) {
      const id = readId(rec[key]);
      if (id) ids.add(id);
    }
    for (const key of ["src", "url"] as const) {
      const url = readUrl(rec[key]);
      if (url) urls.add(url);
    }
    visit(rec.data);
    visit(rec.images);
    visit(rec.initialRefs);
    visit(rec.refs);
  };
  visit(nodes);
  return { ids, urls };
}

export function createProjectRepo(prisma: PrismaClient): ProjectRepo {
  /** 名称撞名时自动追加序号（PRD E4/E6，如「名称 (2)」）。excludeId 用于重命名时排除自身。 */
  async function uniqueName(
    ownerId: bigint,
    desired: string,
    excludeId?: bigint,
  ): Promise<string> {
    const existing = await prisma.project.findMany({
      where: {
        owner_id: ownerId,
        purpose: "canvas",
        is_delete: 0,
        name: { startsWith: desired },
      },
      select: { id: true, name: true },
    });
    const taken = new Set(
      existing
        .filter((row) => excludeId === undefined || row.id !== excludeId)
        .map((row) => row.name),
    );
    if (!taken.has(desired)) return desired;
    let n = 2;
    while (taken.has(`${desired} (${n})`)) n += 1;
    return `${desired} (${n})`;
  }

  /** 批量取每个项目画布上还挂着的最近 3 张 image URL。可用素材 ∩ nodes_json。 */
  async function attachPreviews(
    ownerId: string,
    rows: { id: bigint }[],
    views: ProjectView[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const projectIds = rows.map((row) => row.id);
    const listed = new Set(projectIds);
    const uid = BigInt(ownerId);
    const links = await prisma.project_asset.findMany({
      where: {
        user_id: uid,
        project_id: { in: projectIds },
        is_delete: 0,
      },
      select: { project_id: true, asset_id: true },
    });
    const linkedAssetIds = [...new Set(links.map((link) => link.asset_id))];
    const imageAssets = await prisma.assets.findMany({
      where: {
        user_id: uid,
        type: "image",
        status: "normal",
        is_delete: false,
        OR: [
          { project_id: { in: projectIds } },
          ...(linkedAssetIds.length > 0 ? [{ id: { in: linkedAssetIds } }] : []),
        ],
      },
      orderBy: { gmt_create: "desc" },
      select: { id: true, project_id: true, url: true },
    });
    const membership = new Map<string, Set<bigint>>();
    const addMember = (assetId: bigint, projectId: bigint) => {
      if (!listed.has(projectId)) return;
      const key = assetId.toString();
      const projects = membership.get(key);
      if (projects) projects.add(projectId);
      else membership.set(key, new Set([projectId]));
    };
    for (const asset of imageAssets) addMember(asset.id, asset.project_id);
    for (const link of links) addMember(link.asset_id, link.project_id);
    const canvases = await prisma.canvas.findMany({
      where: { project_id: { in: projectIds }, is_delete: 0 },
      select: { project_id: true, nodes_json: true },
    });
    const onCanvas = new Map<bigint, { ids: Set<string>; urls: Set<string> }>();
    for (const row of canvases) {
      onCanvas.set(row.project_id, collectCanvasImageRefs(row.nodes_json));
    }
    const byProject = new Map<bigint, string[]>();
    for (const asset of imageAssets) {
      const projects = membership.get(asset.id.toString());
      if (!projects) continue;
      const assetId = asset.id.toString();
      for (const projectId of projects) {
        const refs = onCanvas.get(projectId);
        if (!refs || (!refs.ids.has(assetId) && !refs.urls.has(asset.url))) continue;
        const list = byProject.get(projectId);
        if (!list) byProject.set(projectId, [asset.url]);
        else if (list.length < 3) list.push(asset.url);
      }
    }
    for (const view of views) {
      view.previews = byProject.get(BigInt(view.id)) ?? [];
    }
  }

  return {
    async listByOwner(ownerId) {
      const rows = await prisma.project.findMany({
        where: {
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        // 置顶组在前（置顶时间倒序），其余按创建时间倒序（IKH1YI）；
        // MySQL DESC 下 NULL 排最后，未置顶组天然在后，无需 nulls 参数。
        orderBy: [{ pinned_at: "desc" }, { gmt_create: "desc" }],
      });
      const views = rows.map(toView);
      await attachPreviews(ownerId, rows, views);
      return views;
    },
    async listByOwnerPaged(ownerId, page, size) {
      const where = {
        owner_id: BigInt(ownerId),
        purpose: "canvas",
        is_delete: 0,
      };
      const [total, rows] = await Promise.all([
        prisma.project.count({ where }),
        prisma.project.findMany({
          where,
          // 置顶组在前（置顶时间倒序），其余按创建时间倒序（IKH1YI）；
          // id desc 兜底：gmt_create 秒级并列时跨页不重复（对齐 assets 列表）。
          orderBy: [{ pinned_at: "desc" }, { gmt_create: "desc" }, { id: "desc" }],
          skip: (page - 1) * size,
          take: size,
        }),
      ]);
      const views = rows.map(toView);
      await attachPreviews(ownerId, rows, views);
      return { records: views, total, size, current: page };
    },
    async create(ownerId, name) {
      const trimmed = name.trim();
      const finalName = await uniqueName(
        BigInt(ownerId),
        trimmed === "" ? defaultProjectName() : trimmed,
      );
      const row = await prisma.project.create({
        data: { owner_id: BigInt(ownerId), name: finalName },
      });
      return toView(row);
    },
    async findOwnedById(id, ownerId) {
      const row = await prisma.project.findFirst({
        where: { id: BigInt(id), owner_id: BigInt(ownerId), is_delete: 0 },
      });
      return row ? toView(row) : null;
    },
    async findOwnerId(id) {
      let key: bigint;
      try {
        key = BigInt(id);
      } catch {
        // 非数字项目号：调用方是网关而非受控前端，坏输入按查不到处理，不要抛到 500。
        return null;
      }
      const row = await prisma.project.findFirst({
        where: { id: key, is_delete: 0 },
        select: { owner_id: true },
      });
      return row ? row.owner_id.toString() : null;
    },
    async rename(id, ownerId, name) {
      const finalName = await uniqueName(
        BigInt(ownerId),
        name.trim(),
        BigInt(id),
      );
      const updated = await prisma.project.updateMany({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        data: { name: finalName },
      });
      if (updated.count !== 1) return null;
      const row = await prisma.project.findFirst({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
      });
      return row ? toView(row) : null;
    },
    async touchLastOpened(id, ownerId) {
      // 只写 last_opened_at 单列（IKH1YI）：gmt_modified 无 ON UPDATE、schema 无
      // @updatedAt，data 不含 gmt_modified/version 即天然不动二者。
      const updated = await prisma.project.updateMany({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        data: { last_opened_at: new Date() },
      });
      return updated.count === 1;
    },
    async setPinned(id, ownerId, pinned) {
      // 同 touch：只写 pinned_at 两态（置顶=当前时间 / 取消=null），不动 gmt_modified/version。
      const updated = await prisma.project.updateMany({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        data: { pinned_at: pinned ? new Date() : null },
      });
      if (updated.count !== 1) return null;
      const row = await prisma.project.findFirst({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
      });
      return row ? toView(row) : null;
    },
    async delete(id, ownerId) {
      // 逻辑删除（对齐 Java is_delete）。先验归属；级联逻辑删该项目关联资产（PRD O3/E8，不可逆）。
      const owned = await prisma.project.findFirst({
        where: {
          id: BigInt(id),
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        select: { id: true },
      });
      if (!owned) return false;
      await prisma.$transaction([
        prisma.assets.updateMany({
          where: { project_id: BigInt(id), is_delete: false },
          // 级联软删同样盖 deleted_at，否则延迟 GC 永远扫不到这批资产（IKBMDM F1）。
          data: { is_delete: true, deleted_at: new Date() },
        }),
        prisma.project.update({
          where: { id: BigInt(id) },
          data: { is_delete: 1 },
        }),
      ]);
      return true;
    },
    async batchDelete(ownerId, ids) {
      // 一次删除多个项目，各自级联删资产（不可逆）；非本人/不存在的 ID 记为失败项（PRD E14，已删除不回滚）。
      const idNums = ids.map((id) => BigInt(id));
      const owned = await prisma.project.findMany({
        where: {
          id: { in: idNums },
          owner_id: BigInt(ownerId),
          purpose: "canvas",
          is_delete: 0,
        },
        select: { id: true },
      });
      const ownedSet = new Set(owned.map((row) => row.id));
      const toDelete = [...ownedSet];
      if (toDelete.length > 0) {
        await prisma.$transaction([
          prisma.assets.updateMany({
            where: { project_id: { in: toDelete }, is_delete: false },
            // 级联软删同样盖 deleted_at，否则延迟 GC 永远扫不到这批资产（IKBMDM F1）。
            data: { is_delete: true, deleted_at: new Date() },
          }),
          prisma.project.updateMany({
            where: { id: { in: toDelete } },
            data: { is_delete: 1 },
          }),
        ]);
      }
      const succeeded = ids.filter((id) => ownedSet.has(BigInt(id)));
      const failed = ids.filter((id) => !ownedSet.has(BigInt(id)));
      return { succeeded, failed };
    },
  };
}
