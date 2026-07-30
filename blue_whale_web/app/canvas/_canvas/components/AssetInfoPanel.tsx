import type { Asset } from "../model";
import { buildAssetInfoRows } from "../assetInfo";

export function AssetInfoPanel({
  asset,
  loading = false,
}: {
  asset?: Asset;
  loading?: boolean;
}) {
  const rows = asset ? buildAssetInfoRows(asset) : [];

  return (
    <section
      role="dialog"
      aria-label="素材信息"
      className="absolute top-[calc(100%+8px)] right-0 z-20 w-[220px] rounded-lg p-3 shadow-[var(--tc-dropdown-shadow)]"
      style={{
        background: "var(--tc-bg-surface)",
        border: "1px solid var(--tc-border)",
        color: "var(--tc-text-primary)",
      }}
    >
      <h3 className="mb-2 text-xs leading-4 font-medium">素材信息</h3>
      {loading ? (
        <p
          role="status"
          className="text-xs leading-5"
          style={{ color: "var(--tc-text-tertiary)" }}
        >
          正在读取媒体信息…
        </p>
      ) : rows.length === 0 ? (
        <p
          className="text-xs leading-5"
          style={{ color: "var(--tc-text-tertiary)" }}
        >
          无媒体信息
        </p>
      ) : (
        <dl className="grid grid-cols-[48px_1fr] gap-x-3 gap-y-2 text-xs leading-4">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt style={{ color: "var(--tc-text-tertiary)" }}>{row.label}</dt>
              <dd
                className="min-w-0 truncate text-right tabular-nums"
                style={{ color: "var(--tc-text-secondary)" }}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
