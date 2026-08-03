/**
 * IK55VZ 商品卡专属区块组件(从原型 app/prototype/product-card 移植,适配画布节点)。
 * 纯 props 驱动(图片 src 由调用方从 store 解析、回调经 NodeActionsContext 下发),
 * 不直接碰 store;样式一律 --tc-* token。
 */
"use client";

import { useState } from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Link2,
  Plus,
  Upload,
  X,
} from "lucide-react";

import { MAX_PRODUCT_IMAGES, PRODUCT_PLATFORMS } from "../productImport";
import { useInlineEdit } from "./useInlineEdit";

/** 小区段标题行(原型:左 secondary 小字,右 muted 计数)。 */
function SectionRow({ label, right }: { label: string; right?: string }) {
  return (
    <div className="flex items-center">
      <span
        className="text-[11px]"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        {label}
      </span>
      {right && (
        <span
          className="ml-auto text-[11px]"
          style={{ color: "var(--tc-text-muted)" }}
        >
          {right}
        </span>
      )}
    </div>
  );
}

export type ProductImageItem = { id: string; src?: string };

const THUMB_SIZE = 52;

/**
 * 商品图片区(原型截图一/二):「商品图片」+「已启用 n/8」;
 * 空态 150px 虚线框(点击加图);已填=圆角方块横排 + 同尺寸虚线「+」槽(满 8 隐藏);
 * 图块悬停右上角 X 移除。
 */
export function ProductImageSection({
  images,
  onAdd,
  onRemove,
}: {
  images: ProductImageItem[];
  /** 空态虚线框/尾部「+」槽点击(runtime 开 file picker,追加 ≤8)。 */
  onAdd?: () => void;
  onRemove?: (assetId: string) => void;
}) {
  const n = images.length;
  return (
    <div className="px-3 pt-2.5">
      <SectionRow
        label="商品图片"
        right={`已启用 ${n}/${MAX_PRODUCT_IMAGES}`}
      />
      {n === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          className="nodrag mt-1.5 flex w-full flex-col items-center justify-center gap-2 rounded-lg"
          style={{
            height: 150,
            border: "1px dashed var(--tc-border-active)",
            background: "var(--tc-bg-elevated)",
            color: "var(--tc-text-tertiary)",
          }}
        >
          <Upload width={18} height={18} strokeWidth={1.4} />
          <span className="text-xs">拖入或点击添加商品图</span>
        </button>
      ) : (
        <div className="nowheel mt-1.5 flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
          {images.map((img, i) => (
            <div
              key={img.id}
              className="group/thumb relative shrink-0 overflow-hidden rounded-lg"
              style={{
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                background: "var(--tc-bg-elevated)",
                border: "1px solid var(--tc-border-subtle)",
              }}
            >
              {img.src ? (
                // eslint-disable-next-line @next/next/no-img-element -- asset src 为签名 URL/data-URL,不交 next/image 优化器
                <img
                  src={img.src}
                  alt={i === 0 ? "主图" : `图 ${i + 1}`}
                  className="nodrag block h-full w-full"
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <span
                  className="flex h-full w-full items-center justify-center"
                  style={{ color: "var(--tc-text-muted)" }}
                  aria-label={i === 0 ? "主图" : `图 ${i + 1}`}
                >
                  <ImageIcon width={15} height={15} strokeWidth={1.2} />
                </span>
              )}
              <button
                type="button"
                aria-label="移除图片"
                className="nodrag absolute top-0.5 right-0.5 hidden h-4 w-4 items-center justify-center rounded group-hover/thumb:flex"
                style={{
                  background: "var(--tc-bg-overlay)",
                  color: "var(--tc-text-primary)",
                }}
                onClick={() => onRemove?.(img.id)}
              >
                <X width={10} height={10} />
              </button>
            </div>
          ))}
          {n < MAX_PRODUCT_IMAGES && (
            <button
              type="button"
              onClick={onAdd}
              aria-label="添加商品图"
              className="nodrag flex shrink-0 items-center justify-center rounded-lg"
              style={{
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                border: "1px dashed var(--tc-border-active)",
                background: "var(--tc-bg-elevated)",
                color: "var(--tc-text-tertiary)",
              }}
            >
              <Plus width={16} height={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 商品详情区(原型截图一):「商品详情」标签 + 圆角细边框文本框(minHeight 160),
 * 双击就地编辑(Esc 取消/失焦保存)。
 */
export function ProductDetailSection({
  detail,
  placeholder,
  onCommit,
}: {
  detail: string;
  placeholder: string;
  onCommit?: (text: string) => void;
}) {
  const edit = useInlineEdit(onCommit);
  const empty = detail.trim() === "";
  return (
    <div className="px-3 pt-2.5">
      <SectionRow label="商品详情" />
      <div
        className="mt-1.5 rounded-lg px-2.5 py-2"
        style={{
          border: "1px solid var(--tc-border-subtle)",
          minHeight: 160,
        }}
      >
        {edit.editing ? (
          <textarea
            autoFocus
            defaultValue={detail}
            placeholder={placeholder}
            className="nodrag nowheel block w-full resize-none bg-transparent text-xs leading-normal outline-none"
            style={{ color: "var(--tc-text-primary)", minHeight: 144 }}
            onBlur={edit.handleBlur}
            onKeyDown={edit.handleKeyDown}
          />
        ) : (
          <div
            onDoubleClick={edit.startEditing}
            className="text-xs leading-normal"
            style={{
              color: empty ? "var(--tc-text-muted)" : "var(--tc-text-primary)",
              whiteSpace: "pre-wrap",
              cursor: "text",
            }}
          >
            {empty ? placeholder : detail}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 「从商品链接导入」折叠区(原型两张截图定稿,默认展开):
 * 标题行悬停图标+文字变白——用状态驱动内联 color(Tailwind hover 类会被内联 style 压住)。
 * 底条即输入框:透明底 input 覆盖在 pointer-events-none 占位层上;空态显
 * 「支持 + 8 平台图标 + …」,有内容只显 URL 单行截断;右侧白色胶囊「导入」,
 * 空输入置灰禁用。
 */
export function ProductLinkImportSection({
  initialUrl,
  onImport,
}: {
  /** 已导入过的来源链接(data.sourceUrl),回填输入框。 */
  initialUrl?: string;
  /** 点「导入」:runtime mock 解析并填充图片/详情/来源链接。 */
  onImport?: (url: string) => void;
}) {
  const [open, setOpen] = useState(true); // 截图:链接导入区默认展开
  const [url, setUrl] = useState(initialUrl ?? "");
  const [titleHover, setTitleHover] = useState(false);
  const canImport = url.trim() !== "";
  return (
    <div className="px-3 pt-2 pb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setTitleHover(true)}
        onMouseLeave={() => setTitleHover(false)}
        className="nodrag flex w-full items-center gap-1.5 text-[11px]"
        style={{
          color: titleHover
            ? "var(--tc-text-primary)"
            : "var(--tc-text-secondary)",
          transition: "color 120ms",
        }}
        aria-expanded={open}
      >
        <ChevronDown
          width={12}
          height={12}
          style={{
            transform: open ? undefined : "rotate(-90deg)",
            transition: "transform 120ms",
          }}
        />
        <Link2 width={11} height={11} />
        从商品链接导入
      </button>
      {open && (
        <div
          className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2"
          style={{ background: "var(--tc-bg-elevated)" }}
        >
          <div className="relative min-w-0 flex-1">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="商品链接"
              className="nodrag nowheel block w-full truncate bg-transparent text-xs outline-none"
              style={{ color: "var(--tc-text-primary)", height: 20 }}
            />
            {!canImport && (
              <span className="pointer-events-none absolute inset-0 flex items-center gap-2">
                <span
                  className="shrink-0 text-[11px]"
                  style={{ color: "var(--tc-text-secondary)" }}
                >
                  支持
                </span>
                <span className="flex items-center gap-1">
                  {PRODUCT_PLATFORMS.map((p) => (
                    <span
                      key={p.id}
                      className="flex items-center justify-center rounded-full text-[9px]"
                      style={{
                        width: 18,
                        height: 18,
                        background: "var(--tc-bg-surface)",
                        border: "1px solid var(--tc-border-subtle)",
                        color: "var(--tc-text-tertiary)",
                      }}
                    >
                      {p.label}
                    </span>
                  ))}
                </span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onImport?.(url.trim())}
            disabled={!canImport}
            title={canImport ? "导入该链接的商品信息" : "先粘贴商品链接"}
            className="nodrag shrink-0 rounded-full px-3 py-1 text-[11px] font-medium"
            style={{
              background: "var(--tc-text-primary)",
              color: "var(--tc-bg-surface)",
              opacity: canImport ? 1 : 0.35,
              cursor: canImport ? "pointer" : "not-allowed",
            }}
          >
            导入
          </button>
        </div>
      )}
    </div>
  );
}
