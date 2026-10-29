import { wallClockRfc3339, wallClockRfc3339OrNull } from "@lib/core";
import type { PrismaClient } from "@prisma/client";


export interface ProjectPreview {
  url: string;
  type: "image" | "video";
}

export interface ProjectView {
  id: string;
  name: string;
  previews: ProjectPreview[];
  created_at: string;
  last_opened_at: string | null;
  last_edited_at: string;
  pinned_at: string | null;
}

export interface ProjectPage {
  records: ProjectView[];
  total: number;
  size: number;
  current: number;
}

export interface ProjectListOptions {
  keyword?: string;
}

export interface ProjectRepo {
  listByOwner(ownerId: string, options?: ProjectListOptions): Promise<ProjectView[]>;
  listByOwnerPaged(
    ownerId: string,
    page: number,
    size: number,
    options?: ProjectListOptions,
  ): Promise<ProjectPage>;
  listByOwnerRecent(
    ownerId: string,
    limit: number,
    options?: ProjectListOptions,
  ): Promise<ProjectView[]>;
  create(ownerId: string, name: string): Promise<ProjectView>;
  findOwnedById(id: string, ownerId: string): Promise<ProjectView | null>;
  findOwnerId(id: string): Promise<string | null>;
  rename(
    id: string,
    ownerId: string,
    name: string,
  ): Promise<ProjectView | null>;
  touchLastOpened(id: string, ownerId: string): Promise<boolean>;
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
  gmt_create: Date;
  last_opened_at: Date | null;
  last_edited_at: Date;
  pinned_at: Date | null;
}): ProjectView {
  return {
    id: row.id.toString(),
    name: row.name,
    previews: [],
    created_at: wallClockRfc3339(row.gmt_create),
    last_opened_at: wallClockRfc3339OrNull(row.last_opened_at) ?? null,
    last_edited_at: wallClockRfc3339(row.last_edited_at),
    pinned_at: wallClockRfc3339OrNull(row.pinned_at) ?? null,
  };
}

function defaultProjectName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

const NON_MEDIA_PREVIEW_TYPES = new Set(["audio"]);

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

function collectCanvasMediaRefs(nodes: unknown): { ids: Set<string>; urls: Set<string> } {
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
    if (typeof mediaType === "string" && NON_MEDIA_PREVIEW_TYPES.has(mediaType)) return;
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
    const mediaAssets = await prisma.assets.findMany({
      where: {
        user_id: uid,
        type: { in: ["image", "video"] },
        status: "normal",
        is_delete: false,
        OR: [
          { project_id: { in: projectIds } },
          ...(linkedAssetIds.length > 0 ? [{ id: { in: linkedAssetIds } }] : []),
        ],
      },
      orderBy: { gmt_create: "desc" },
      select: { id: true, project_id: true, url: true, type: true },
    });
    const membership = new Map<string, Set<bigint>>();
    const addMember = (assetId: bigint, projectId: bigint) => {
      if (!listed.has(projectId)) return;
      const key = assetId.toString();
      const projects = membership.get(key);
      if (projects) projects.add(projectId);
      else membership.set(key, new Set([projectId]));
    };
    for (const asset of mediaAssets) addMember(asset.id, asset.project_id);
    for (const link of links) addMember(link.asset_id, link.project_id);
    const canvases = await prisma.canvas.findMany({
      where: { project_id: { in: projectIds }, is_delete: 0 },
      select: { project_id: true, nodes_json: true },
    });
    const onCanvas = new Map<bigint, { ids: Set<string>; urls: Set<string> }>();
    for (const row of canvases) {
      onCanvas.set(row.project_id, collectCanvasMediaRefs(row.nodes_json));
    }
    const byProject = new Map<bigint, ProjectPreview[]>();
    for (const asset of mediaAssets) {
      const projects = membership.get(asset.id.toString());
      if (!projects) continue;
      const assetId = asset.id.toString();
      for (const projectId of projects) {
        const refs = onCanvas.get(projectId);
        if (!refs || (!refs.ids.has(assetId) && !refs.urls.has(asset.url))) continue;
        const preview: ProjectPreview = {
          url: asset.url,
          type: asset.type === "video" ? "video" : "image",
        };
        const list = byProject.get(projectId);
        if (!list) byProject.set(projectId, [preview]);
        else if (list.length < 3) list.push(preview);
      }
    }
    for (const view of views) {
      view.previews = byProject.get(BigInt(view.id)) ?? [];
    }
  }

  function listWhere(ownerId: string, options: ProjectListOptions | undefined) {
    const keyword = options?.keyword?.trim();
    return {
      owner_id: BigInt(ownerId),
      purpose: "canvas",
      is_delete: 0,
      ...(keyword ? { name: { contains: keyword } } : {}),
    };
  }

  const LIST_ORDER = [
    { pinned_at: "desc" as const },
    { last_edited_at: "desc" as const },
    { id: "desc" as const },
  ];

  return {
    async listByOwner(ownerId, options) {
      const rows = await prisma.project.findMany({
        where: listWhere(ownerId, options),
        orderBy: LIST_ORDER,
      });
      const views = rows.map(toView);
      await attachPreviews(ownerId, rows, views);
      return views;
    },
    async listByOwnerPaged(ownerId, page, size, options) {
      const where = listWhere(ownerId, options);
      const [total, rows] = await Promise.all([
        prisma.project.count({ where }),
        prisma.project.findMany({
          where,
          orderBy: LIST_ORDER,
          skip: (page - 1) * size,
          take: size,
        }),
      ]);
      const views = rows.map(toView);
      await attachPreviews(ownerId, rows, views);
      return { records: views, total, size, current: page };
    },
    async listByOwnerRecent(ownerId, limit, options) {
      const rows = await prisma.project.findMany({
        where: listWhere(ownerId, options),
        orderBy: LIST_ORDER,
        take: limit,
      });
      const views = rows.map(toView);
      await attachPreviews(ownerId, rows, views);
      return views;
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
