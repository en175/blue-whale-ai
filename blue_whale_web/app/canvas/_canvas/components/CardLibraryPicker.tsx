// IK55VX 卡片库(共享资产)选择器 — 居中模态:文件夹侧栏 + tabs 行(全部/资产▾/各媒体) +
// 搜索 + 选择 + 网格(封面/名称/类型徽章/日期/···);点击卡片弹放大详情浮窗(「添加到画布」=导入)。
// 视觉 1:1 按产品截图(用户确认的原型);数据走 cardLibrary mock(导入=复制快照,不回写库)。
// 复用:商品卡导入(IK55VZ)传 cardTypeFilter={["product"]} 即可沿用。
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  BarChart3,
  Box,
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  MoreHorizontal,
  Mountain,
  Package,
  Palette,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";

import {
  CARD_LIBRARY_TYPE_LABELS,
  getCardLibraryAsset,
  listCardLibrary,
  removeCardLibraryItem,
  type CardLibraryItem,
  type SharedAssetType,
} from "../cardLibrary";
import type { ReferenceCardType } from "../model";

const TYPE_ORDER: ReferenceCardType[] = [
  "style",
  "character",
  "object",
  "environment",
  "custom",
  "product",
];

const TYPE_ICONS: Record<ReferenceCardType, typeof User> = {
  style: Palette,
  character: User,
  object: Box,
  environment: Mountain,
  custom: LayoutGrid,
  product: Package,
};

/** 截图 tabs 行:卡片挂在「资产」下,媒体 tab 按类型过滤(IK5MC9 保存后有条目)。 */
const MEDIA_TABS = [
  "图片",
  "视频",
  "音频",
  "文本",
  "场景",
  "商品",
  "其他",
] as const;
type MediaTab = "全部" | "资产" | (typeof MEDIA_TABS)[number];

/** 媒体 tab 中文名 → 库 cardType 映射（IK5MC9）。 */
const TAB_TO_TYPE: Partial<Record<MediaTab, SharedAssetType>> = {
  图片: "image",
  视频: "video",
  音频: "audio",
  文本: "text",
  商品: "product",
};

/** 遮罩壳:点外关闭 + 居中(画布 modal 惯例,同 ExpandModal)。 */
function Overlay({
  ariaLabel,
  onClose,
  width,
  height,
  zIndex = 50,
  closeOnEscape = true,
  children,
}: {
  ariaLabel: string;
  onClose: () => void;
  width: number;
  height?: string;
  zIndex?: number;
  closeOnEscape?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closeOnEscape]);
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex, background: "var(--tc-bg-overlay)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-2xl"
        style={{
          width,
          maxWidth: "calc(100vw - 48px)",
          height: height ?? "auto",
          maxHeight: "calc(100vh - 64px)",
          background: "var(--tc-bg-surface)",
          border: "1px solid var(--tc-border)",
          boxShadow: "var(--tc-modal-shadow)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );
}

function cardCover(card: CardLibraryItem): string | undefined {
  return card.imageAssetId
    ? getCardLibraryAsset(card.imageAssetId)?.src
    : undefined;
}

/** 详情浮窗(截图3):类型行 + 内卡(@名称/左边线描述/大图) + 浅色「添加到画布」。 */
function CardDetailOverlay({
  card,
  onClose,
  onImport,
}: {
  card: CardLibraryItem;
  onClose: () => void;
  onImport: (card: CardLibraryItem) => void;
}) {
  const TypeIcon = TYPE_ICONS[card.cardType as ReferenceCardType] ?? ImageIcon;
  const cover = cardCover(card);
  return (
    <Overlay
      ariaLabel={`${card.name}详情`}
      onClose={onClose}
      width={520}
      zIndex={51}
    >
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-1.5 text-[13px]"
            style={{ color: "var(--tc-text-secondary)" }}
          >
            <TypeIcon size={14} />
            {CARD_LIBRARY_TYPE_LABELS[card.cardType]}
          </div>
          <button
            type="button"
            aria-label="关闭详情"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/45 hover:bg-white/[0.06] hover:text-white/80"
          >
            <X size={15} />
          </button>
        </div>
        <div
          className="mt-3 rounded-xl border p-4"
          style={{
            borderColor: "var(--tc-border-subtle)",
            background: "var(--tc-bg-elevated)",
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full"
              style={{
                background: "var(--tc-bg-surface)",
                color: "var(--tc-text-secondary)",
              }}
            >
              <AtSign size={13} />
            </span>
            <span
              className="text-[16px] font-semibold"
              style={{ color: "var(--tc-text-primary)" }}
            >
              {card.name}
            </span>
          </div>
          <p
            className="mt-3 whitespace-pre-wrap border-l-2 pl-3 text-[13px] leading-relaxed"
            style={{
              borderColor: "var(--tc-border-subtle)",
              color: "var(--tc-text-secondary)",
            }}
          >
            {card.description}
          </p>
          {cover && (
            <div className="mt-3 overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt={card.name}
                className="w-full object-cover"
              />
            </div>
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onImport(card)}
            className="flex items-center gap-1.5 rounded-lg bg-white/90 px-4 py-2 text-[13px] font-medium text-black hover:bg-white"
          >
            <Plus size={14} />
            添加到画布
          </button>
        </div>
      </div>
    </Overlay>
  );
}

export function CardLibraryPicker({
  onClose,
  onImport,
  cardTypeFilter,
}: {
  onClose: () => void;
  /** 选定某张库卡(导入语义=复制快照,由调用方 cloneCardSnapshot 后落画布)。 */
  onImport: (card: CardLibraryItem) => void;
  /** 限定可选卡片类型(IK55VZ 商品卡导入传 ["product"]);缺省=全部类型。 */
  cardTypeFilter?: ReferenceCardType[];
}) {
  const [items, setItems] = useState<CardLibraryItem[]>(() =>
    listCardLibrary(),
  );
  const [mediaTab, setMediaTab] = useState<MediaTab>("资产");
  const [cardType, setCardType] = useState<ReferenceCardType | "all">("all");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("全部资产");
  const [folders, setFolders] = useState(["default"]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CardLibraryItem | null>(null);
  const [menuForId, setMenuForId] = useState<string | null>(null);
  const typeMenuRef = useRef<HTMLDivElement>(null);

  const availableTypes = cardTypeFilter ?? TYPE_ORDER;

  // 点外关闭「资产 ▾」类型菜单
  useEffect(() => {
    if (!typeMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!typeMenuRef.current?.contains(e.target as Node))
        setTypeMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [typeMenuOpen]);

  // 点外关闭卡片「···」菜单
  useEffect(() => {
    if (!menuForId) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-card-menu]"))
        setMenuForId(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuForId]);

  const shown = useMemo(() => {
    let list = items;
    if (mediaTab !== "全部" && mediaTab !== "资产") {
      const typeKey = TAB_TO_TYPE[mediaTab];
      if (!typeKey) return [];
      list = list.filter((c) => c.cardType === typeKey);
    }
    if (cardTypeFilter)
      list = list.filter((c) =>
        cardTypeFilter.includes(c.cardType as ReferenceCardType),
      );
    if (mediaTab === "资产" && cardType !== "all")
      list = list.filter((c) => c.cardType === cardType);
    if (query.trim()) list = list.filter((c) => c.name.includes(query.trim()));
    return list;
  }, [items, mediaTab, cardType, cardTypeFilter, query]);

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCardClick = (card: CardLibraryItem) => {
    if (selecting) toggleSelect(card.id);
    else setDetail(card);
  };

  const importSelected = () => {
    for (const c of items) if (selected.has(c.id)) onImport(c);
    setSelected(new Set());
    setSelecting(false);
  };

  /** 「···」→ 移除资产 = 从 mock 库删除并刷新列表。 */
  const handleRemove = (card: CardLibraryItem) => {
    removeCardLibraryItem(card.id);
    setItems(listCardLibrary());
  };

  return (
    <>
      <Overlay
        ariaLabel="共享资产"
        onClose={onClose}
        width={1040}
        height="min(72vh, 720px)"
        closeOnEscape={!detail}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} style={{ color: "var(--tc-text-primary)" }} />
            <span
              className="text-[15px] font-semibold"
              style={{ color: "var(--tc-text-primary)" }}
            >
              共享资产
            </span>
          </div>
          <button
            type="button"
            aria-label="关闭共享资产"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/45 hover:bg-white/[0.06] hover:text-white/80"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 flex min-h-0 flex-1">
          {/* 文件夹侧栏(截图2;mock 无文件夹语义,仅呈现) */}
          <div
            className="flex w-[200px] shrink-0 flex-col gap-1 border-r px-3 pb-4"
            style={{ borderColor: "var(--tc-border-subtle)" }}
          >
            {["全部资产", ...folders].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFolder(f)}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px]"
                style={{
                  background:
                    folder === f ? "var(--tc-bg-elevated)" : "transparent",
                  color:
                    folder === f
                      ? "var(--tc-text-primary)"
                      : "var(--tc-text-secondary)",
                }}
              >
                <span className="flex items-center gap-2">
                  {f === "全部资产" ? (
                    <LayoutGrid size={14} />
                  ) : (
                    <Folder size={14} />
                  )}
                  {f}
                </span>
                <span
                  className="text-[11px]"
                  style={{ color: "var(--tc-text-muted)" }}
                >
                  {items.length}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                setFolders((fs) => [...fs, `新建文件夹 ${fs.length}`])
              }
              className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-[13px]"
              style={{
                borderColor: "var(--tc-border-subtle)",
                color: "var(--tc-text-muted)",
              }}
            >
              <FolderPlus size={14} />
              新建文件夹
            </button>
          </div>

          {/* 主区 */}
          <div className="flex min-w-0 flex-1 flex-col px-5 pb-4">
            {/* tabs 行 + 搜索 + 选择 */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                {(["全部", "资产"] as const).map((t) => (
                  <div
                    key={t}
                    className="relative"
                    ref={t === "资产" ? typeMenuRef : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMediaTab(t);
                        if (t === "资产") setTypeMenuOpen((o) => !o);
                      }}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px]"
                      style={{
                        background:
                          mediaTab === t
                            ? "var(--tc-bg-elevated)"
                            : "transparent",
                        color:
                          mediaTab === t
                            ? "var(--tc-text-primary)"
                            : "var(--tc-text-muted)",
                        fontWeight: mediaTab === t ? 600 : 400,
                      }}
                    >
                      {t}
                      {t === "资产" && <ChevronDown size={12} />}
                    </button>
                    {/* 「资产 ▾」下拉 = 按卡片类型筛选 */}
                    {t === "资产" && typeMenuOpen && (
                      <div
                        className="absolute left-0 top-full z-10 mt-1 w-[128px] rounded-lg border py-1"
                        style={{
                          background: "var(--tc-bg-elevated)",
                          borderColor: "var(--tc-border-subtle)",
                        }}
                      >
                        {(["all", ...availableTypes] as const).map((ct) => (
                          <button
                            key={ct}
                            type="button"
                            onClick={() => {
                              setCardType(ct);
                              setTypeMenuOpen(false);
                            }}
                            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-white/[0.06]"
                            style={{
                              color:
                                cardType === ct
                                  ? "var(--tc-text-primary)"
                                  : "var(--tc-text-secondary)",
                            }}
                          >
                            {ct === "all"
                              ? "全部类型"
                              : CARD_LIBRARY_TYPE_LABELS[ct]}
                            {cardType === ct && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {MEDIA_TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMediaTab(t)}
                    className="rounded-lg px-3 py-1.5 text-[13px]"
                    style={{
                      background:
                        mediaTab === t
                          ? "var(--tc-bg-elevated)"
                          : "transparent",
                      color:
                        mediaTab === t
                          ? "var(--tc-text-primary)"
                          : "var(--tc-text-muted)",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
                  style={{
                    borderColor: "var(--tc-border-subtle)",
                    background: "var(--tc-bg-surface)",
                  }}
                >
                  <Search size={13} style={{ color: "var(--tc-text-muted)" }} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索资产"
                    className="w-[110px] bg-transparent text-[12px] outline-none placeholder:text-[var(--tc-text-muted)]"
                    style={{ color: "var(--tc-text-primary)" }}
                  />
                </div>
                {selecting ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setSelecting(false);
                        setSelected(new Set());
                      }}
                      className="rounded-lg border px-3 py-1.5 text-[12px]"
                      style={{
                        borderColor: "var(--tc-border-subtle)",
                        color: "var(--tc-text-secondary)",
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={importSelected}
                      disabled={selected.size === 0}
                      className="rounded-lg bg-white/90 px-3 py-1.5 text-[12px] font-medium text-black disabled:opacity-40"
                    >
                      添加 {selected.size} 项
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelecting(true)}
                    className="rounded-lg border px-3 py-1.5 text-[12px]"
                    style={{
                      borderColor: "var(--tc-border-subtle)",
                      color: "var(--tc-text-secondary)",
                    }}
                  >
                    选择
                  </button>
                )}
              </div>
            </div>

            {/* 网格:封面 + 名称 + 类型徽章/日期/··· */}
            <div className="mt-4 grid min-h-0 flex-1 auto-rows-min grid-cols-4 gap-4 overflow-y-auto pr-1">
              {shown.map((card) => {
                const cover = cardCover(card);
                return (
                  <div
                    key={card.id}
                    className="cursor-pointer"
                    onClick={() => handleCardClick(card)}
                  >
                    <div
                      className="relative flex h-[130px] w-full items-center justify-center overflow-hidden rounded-xl p-2 transition-colors"
                      style={{
                        background: "var(--tc-bg-elevated)",
                        outline:
                          selecting && selected.has(card.id)
                            ? "2px solid var(--tc-accent)"
                            : "none",
                      }}
                    >
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cover}
                          alt={card.name}
                          className="max-h-full max-w-full rounded-lg object-contain"
                        />
                      ) : (
                        <ImageIcon
                          size={24}
                          strokeWidth={1.2}
                          style={{ color: "var(--tc-text-muted)" }}
                        />
                      )}
                      {selecting && (
                        <span
                          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border"
                          style={{
                            borderColor: "var(--tc-border-subtle)",
                            background: selected.has(card.id)
                              ? "var(--tc-accent)"
                              : "var(--tc-bg-overlay)",
                            color: "white",
                          }}
                        >
                          {selected.has(card.id) && <Check size={12} />}
                        </span>
                      )}
                    </div>
                    <div
                      className="mt-2 truncate text-[13px] font-medium"
                      style={{ color: "var(--tc-text-primary)" }}
                    >
                      {card.name}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px]"
                        style={{
                          background: "var(--tc-bg-elevated)",
                          color: "var(--tc-text-secondary)",
                        }}
                      >
                        {CARD_LIBRARY_TYPE_LABELS[card.cardType]}
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: "var(--tc-text-muted)" }}
                      >
                        {card.createdAt}
                      </span>
                      {/* 「···」更多菜单(截图4):添加到画布 / 移除资产(红) */}
                      <div className="relative ml-auto" data-card-menu>
                        <button
                          type="button"
                          aria-label={`${card.name}更多操作`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuForId((id) =>
                              id === card.id ? null : card.id,
                            );
                          }}
                          className="flex h-6 w-7 items-center justify-center rounded-md hover:bg-white/[0.08]"
                          style={{ color: "var(--tc-text-muted)" }}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {menuForId === card.id && (
                          <div
                            className="absolute right-0 top-full z-10 mt-1 w-[150px] rounded-xl border p-1.5"
                            style={{
                              background: "var(--tc-bg-elevated)",
                              borderColor: "var(--tc-border-subtle)",
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setMenuForId(null);
                                onImport(card);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-white/[0.06]"
                              style={{ color: "var(--tc-text-primary)" }}
                            >
                              <Plus size={14} />
                              添加到画布
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuForId(null);
                                handleRemove(card);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-white/[0.06]"
                              style={{ color: "var(--tc-destructive)" }}
                            >
                              <Trash2 size={14} />
                              移除资产
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {shown.length === 0 && (
                <div
                  className="col-span-4 py-16 text-center text-[13px]"
                  style={{ color: "var(--tc-text-muted)" }}
                >
                  暂无资产
                </div>
              )}
            </div>
          </div>
        </div>
      </Overlay>
      {detail && (
        <CardDetailOverlay
          card={detail}
          onClose={() => setDetail(null)}
          onImport={(c) => {
            setDetail(null);
            onImport(c);
          }}
        />
      )}
    </>
  );
}
