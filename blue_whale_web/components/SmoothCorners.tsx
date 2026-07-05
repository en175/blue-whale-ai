import { useId } from "react";

export function SmoothCorners({
  width,
  height,
  path,
  children,
  className,
  style,
  overlay = true,
  dataAttributes,
  stroke,
}: {
  width: number;
  height: number;
  path: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  overlay?: boolean;
  dataAttributes?: Record<string, string>;
  stroke?: { color?: string; width?: number; opacity?: number };
}) {
  const baseId = useId().replace(/:/g, "");
  const clipId = `sc-clip-${baseId}`;
  const maskId = `sc-mask-${baseId}`;
  const dblInnerId = `sc-dbl-inner-${baseId}`;
  const dblOuterId = `sc-dbl-outer-${baseId}`;
  const dblMiddleId = `sc-dbl-middle-${baseId}`;

  const strokeColor = stroke?.color ?? "#ffffff";
  const strokeWidth = stroke?.width ?? 2;
  const strokeOpacity = stroke?.opacity ?? 0.1;

  const dataProps: Record<string, string> = Object.entries(dataAttributes ?? {}).reduce(
    (acc, [key, value]) => {
      const dataKey = key.startsWith("data-") ? key : `data-${key}`;
      acc[dataKey] = value;
      return acc;
    },
    {
      "data-slot": "smooth-corners",
      "data-state": "ready",
    } as Record<string, string>
  );

  return (
    <div
      className={["relative inline-flex", className || ""].join(" ")}
      style={{
        width,
        height,
        clipPath: `url(#${clipId})`,
        ...style,
      }}
      {...dataProps}
    >
      {children}
      <svg
        aria-hidden="true"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 pointer-events-none overflow-visible"
        style={{ zIndex: 1, display: "block" }}
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <path d={path} />
          </clipPath>
          {stroke && (
            <>
              <mask id={maskId} maskUnits="userSpaceOnUse">
                <rect fill="white" width={width} height={height} />
                <path fill="black" d={path} />
              </mask>
              <mask id={dblInnerId} maskUnits="userSpaceOnUse">
                <rect fill="white" width={width} height={height} />
                <path fill="none" stroke="black" />
              </mask>
              <mask id={dblOuterId} maskUnits="userSpaceOnUse">
                <rect fill="white" width={width} height={height} />
                <path fill="none" stroke="black" />
              </mask>
              <mask id={dblMiddleId} maskUnits="userSpaceOnUse">
                <rect fill="white" width={width} height={height} />
                <path fill="none" stroke="black" />
              </mask>
            </>
          )}
        </defs>
        {stroke && <g clipPath={`url(#${clipId})`} />}
        <g>
          {stroke && (
            <path
              fill="none"
              clipPath={`url(#${clipId})`}
              d={path}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeOpacity={strokeOpacity}
              strokeLinecap="butt"
            />
          )}
          {stroke && (
            <path fill="none" clipPath={`url(#${clipId})`} style={{ display: "none" }} />
          )}
        </g>
        {stroke && (
          <>
            <g>
              <path fill="none" mask={`url(#${maskId})`} style={{ display: "none" }} />
              <path fill="none" mask={`url(#${maskId})`} style={{ display: "none" }} />
            </g>
            <g>
              <path fill="none" style={{ display: "none" }} />
              <path fill="none" style={{ display: "none" }} />
            </g>
          </>
        )}
        {overlay && (
          <rect
            width={width}
            height={height}
            fill="rgba(255,255,255,0.04)"
            clipPath={`url(#${clipId})`}
          />
        )}
      </svg>
    </div>
  );
}
