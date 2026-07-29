"use client";

/**
 * 用户级全局资产库：展示全部素材，并支持图片 / 视频 / 音频上传与逻辑删除。
 * Assets 不选择或关联 Canvas Project；上传时不发送 project_id。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  deleteAsset,
  listAssets,
  uploadAsset,
  type AssetItem,
} from "@/lib/assets";
import { detectMediaKind, type MediaKind } from "@/lib/mediaSize";

type Filter = "all" | MediaKind;

type PendingUpload = {
  id: string;
  name: string;
  type: MediaKind;
  state: "uploading" | "error";
  error?: string;
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
];
const ASSET_PAGE_SIZE = 60;
const MAX_ASSET_SCAN_ATTEMPTS = 4;

async function fetchAssetSnapshot(type?: string): Promise<{
  records: AssetItem[];
  signature: string;
  complete: boolean;
}> {
  const firstPage = await listAssets({
    type,
    page: 1,
    size: ASSET_PAGE_SIZE,
  });
  const pageCount = Math.ceil(firstPage.total / ASSET_PAGE_SIZE);
  const remainingPages =
    pageCount <= 1
      ? []
      : await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, index) =>
            listAssets({
              type,
              page: index + 2,
              size: ASSET_PAGE_SIZE,
            }),
          ),
        );
  const pages = [firstPage, ...remainingPages];
  const records: AssetItem[] = [];
  const seen = new Set<string>();
  for (const item of pages.flatMap((page) => page.records)) {
    const id = String(item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    records.push(item);
  }
  const totalsStable = pages.every((page) => page.total === firstPage.total);
  return {
    records,
    signature: `${firstPage.total}:${records
      .map((item) => String(item.id))
      .join(",")}`,
    complete: totalsStable && records.length === firstPage.total,
  };
}

const PILL_BUTTON =
  "inline-flex items-center gap-1.5 rounded-lg border border-[var(--tc-border)] px-3 py-1.5 text-sm text-[var(--tc-text-secondary)] transition-colors hover:text-[var(--tc-text-primary)] disabled:cursor-default disabled:opacity-50";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function AssetPreview({ asset }: { asset: AssetItem }) {
  if (asset.type === "video") {
    return (
      <video
        src={asset.url}
        className="aspect-square w-full object-cover"
        muted
        loop
        playsInline
      />
    );
  }
  if (asset.type === "audio") {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-[var(--tc-bg-elevated)] px-3">
        <AudioLines
          width={36}
          height={36}
          aria-hidden="true"
          className="text-[var(--tc-text-secondary)]"
        />
        <audio src={asset.url} controls className="h-8 w-full" />
      </div>
    );
  }
  return (
    // Asset URLs are dynamic user uploads and cannot use a fixed Next image loader.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={asset.url} alt="" className="aspect-square w-full object-cover" />
  );
}

function PendingTile({
  item,
  onRemove,
}: {
  item: PendingUpload;
  onRemove: () => void;
}) {
  return (
    <div className="relative flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-elevated)] px-3 text-center">
      {item.state === "uploading" ? (
        <Loader2
          width={28}
          height={28}
          aria-hidden="true"
          className="animate-spin text-[var(--tc-text-secondary)]"
        />
      ) : (
        <>
          <AlertCircle
            width={28}
            height={28}
            aria-hidden="true"
            className="text-[var(--tc-destructive)]"
          />
          <button
            type="button"
            aria-label={`移除失败素材 ${item.name}`}
            onClick={onRemove}
            className="absolute right-2 top-2 rounded-md p-1 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)]"
          >
            <X width={14} height={14} aria-hidden="true" />
          </button>
        </>
      )}
      <span className="max-w-full truncate text-xs text-[var(--tc-text-primary)]">
        {item.name}
      </span>
      <span
        className={
          item.state === "error"
            ? "text-xs text-[var(--tc-destructive)]"
            : "text-xs text-[var(--tc-text-muted)]"
        }
      >
        {item.state === "uploading" ? "上传中…" : item.error}
      </span>
    </div>
  );
}

export default function AssetsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestGenerationRef = useRef(0);
  const deletedIdsRef = useRef(new Set<string>());
  const uploadedItemsRef = useRef(new Map<string, AssetItem>());
  const [items, setItems] = useState<AssetItem[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setLoading(true);
    try {
      const type = filter === "all" ? undefined : filter;
      let previousSignature: string | null = null;
      let stableRecords: AssetItem[] | null = null;
      for (let attempt = 0; attempt < MAX_ASSET_SCAN_ATTEMPTS; attempt += 1) {
        const snapshot = await fetchAssetSnapshot(type);
        if (requestGenerationRef.current !== requestGeneration) return;
        if (snapshot.complete && previousSignature === snapshot.signature) {
          stableRecords = snapshot.records;
          break;
        }
        previousSignature = snapshot.complete ? snapshot.signature : null;
      }
      if (!stableRecords) {
        throw new Error("素材列表变化中，请稍后重试");
      }

      const serverItems = stableRecords.filter(
        (item) => !deletedIdsRef.current.has(String(item.id)),
      );
      const localUploads = Array.from(uploadedItemsRef.current.values()).filter(
        (item) => type == null || item.type === type,
      );
      const localIds = new Set(localUploads.map((item) => String(item.id)));
      setItems([
        ...localUploads,
        ...serverItems.filter((item) => !localIds.has(String(item.id))),
      ]);
      setError(null);
    } catch (loadError) {
      if (requestGenerationRef.current !== requestGeneration) return;
      setError(errorMessage(loadError, "加载失败"));
    } finally {
      if (requestGenerationRef.current === requestGeneration) {
        setLoading(false);
      }
    }
  }, [filter]);

  useEffect(() => {
    // 数据获取是 React 官方认可模式；set-state-in-effect 规则对列表 fetch 误报。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [load]);

  const handleUpload = useCallback((file: File) => {
    const type = detectMediaKind(file);
    const pendingId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setPending((current) => [
      { id: pendingId, name: file.name, type, state: "uploading" },
      ...current,
    ]);
    void uploadAsset(file)
      .then((uploaded) => {
        const item: AssetItem = {
          id: uploaded.id,
          type,
          url: uploaded.url,
          width: null,
          height: null,
          duration: null,
          source: "uploaded",
          created_at: new Date().toISOString(),
        };
        uploadedItemsRef.current.set(String(uploaded.id), item);
        deletedIdsRef.current.delete(String(uploaded.id));
        setPending((current) =>
          current.filter((candidate) => candidate.id !== pendingId),
        );
        setItems((current) => [
          item,
          ...current.filter(
            (candidate) => String(candidate.id) !== String(uploaded.id),
          ),
        ]);
      })
      .catch((uploadError) => {
        setPending((current) =>
          current.map((item) =>
            item.id === pendingId
              ? {
                  ...item,
                  state: "error",
                  error: errorMessage(uploadError, "上传失败"),
                }
              : item,
          ),
        );
      });
  }, []);

  const handleDelete = useCallback(() => {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    setDeleting(true);
    setDeleteError(null);
    void deleteAsset(target.id)
      .then(() => {
        const targetId = String(target.id);
        deletedIdsRef.current.add(targetId);
        uploadedItemsRef.current.delete(targetId);
        setItems((current) =>
          current.filter((item) => String(item.id) !== targetId),
        );
        setDeleteTarget(null);
      })
      .catch((deleteFailure) => {
        setDeleteError(errorMessage(deleteFailure, "删除失败"));
      })
      .finally(() => setDeleting(false));
  }, [deleteTarget, deleting]);

  const visiblePending = pending.filter(
    (item) => filter === "all" || item.type === filter,
  );

  return (
    <main className="flex min-h-screen flex-col bg-[var(--background)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-outfit text-2xl font-semibold text-[var(--tc-text-primary)]">
            资产库
          </h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {FILTERS.map((item) => {
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={
                    "rounded-lg border px-3 py-1 text-sm transition-colors " +
                    (active
                      ? "border-[var(--tc-accent)] bg-[var(--tc-accent)] text-white"
                      : "border-[var(--tc-border)] bg-transparent text-[var(--tc-text-secondary)] hover:text-[var(--tc-text-primary)]")
                  }
                >
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={PILL_BUTTON}
            >
              <Upload width={14} height={14} aria-hidden="true" />
              上传素材
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              aria-label="上传素材"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) handleUpload(file);
              }}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-[var(--tc-destructive)]">{error}</p>
        )}
        {loading && items.length === 0 && visiblePending.length === 0 ? (
          <p className="text-sm text-[var(--tc-text-muted)]">加载中…</p>
        ) : items.length === 0 && visiblePending.length === 0 ? (
          <p className="text-sm text-[var(--tc-text-muted)]">暂无资产。</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visiblePending.map((item) => (
              <PendingTile
                key={item.id}
                item={item}
                onRemove={() =>
                  setPending((current) =>
                    current.filter((candidate) => candidate.id !== item.id),
                  )
                }
              />
            ))}
            {items.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]"
              >
                <AssetPreview asset={asset} />
                <button
                  type="button"
                  aria-label={`删除素材 ${asset.id}`}
                  title="删除素材"
                  onClick={() => {
                    setDeleteTarget(asset);
                    setDeleteError(null);
                  }}
                  className="absolute right-2 top-2 rounded-md border border-[var(--tc-border)] bg-[var(--tc-bg-overlay)] p-1.5 text-[var(--tc-text-secondary)] opacity-0 transition-opacity hover:text-[var(--tc-text-primary)] group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 width={14} height={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="删除素材"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--tc-bg-overlay)] px-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-4 shadow-[var(--tc-modal-shadow)]">
            <h2 className="text-sm font-semibold text-[var(--tc-text-primary)]">
              删除这项素材？
            </h2>
            <p className="mt-2 text-xs leading-5 text-[var(--tc-text-secondary)]">
              删除后，引用该素材的画布节点可能无法继续使用。此操作不可撤销。
            </p>
            {deleteError && (
              <p className="mt-2 text-xs text-[var(--tc-destructive)]">
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className={PILL_BUTTON}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-[var(--tc-destructive)] px-3 py-1.5 text-xs text-white disabled:cursor-default disabled:opacity-50"
              >
                {deleting ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
