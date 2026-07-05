export interface AspectRatioIconProps {
  ratio: string;
  width?: number;
  height?: number;
  filled?: boolean;
}

export function AspectRatioIcon({ ratio, width = 16, height = 16, filled = true }: AspectRatioIconProps) {
  const rect: Record<
    string,
    { x: number; y: number; width: number; height: number; rx: number }
  > = {
    "9:16": { x: 4.0625, y: 1, width: 7.875, height: 14, rx: 1.5 },
    "3:4": { x: 2.75, y: 1, width: 10.5, height: 14, rx: 1.5 },
    "1:1": { x: 1, y: 1, width: 14, height: 14, rx: 1.5 },
    "4:3": { x: 1, y: 2.75, width: 14, height: 10.5, rx: 1.5 },
    "16:9": { x: 1, y: 4.0625, width: 14, height: 7.875, rx: 1.5 },
    "2:3": { x: 3.333333333333333, y: 1, width: 9.333333333333334, height: 14, rx: 1.5 },
    "3:2": { x: 1, y: 3.333333333333333, width: 14, height: 9.333333333333334, rx: 1.5 },
    "5:4": { x: 1, y: 2.4000000000000004, width: 14, height: 11.2, rx: 1.5 },
    "4:5": { x: 2.4000000000000004, y: 1, width: 11.2, height: 14, rx: 1.5 },
    "21:9": { x: 1, y: 5, width: 14, height: 6, rx: 1.5 },
    "9:21": { x: 5, y: 1, width: 6, height: 14, rx: 1.5 },
    "1:2": { x: 4.5, y: 1, width: 7, height: 14, rx: 1.5 },
    "2:1": { x: 1, y: 4.5, width: 14, height: 7, rx: 1.5 },
  };

  const r = rect[ratio] ?? rect["1:1"];

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <rect
        x={r.x}
        y={r.y}
        width={r.width}
        height={r.height}
        rx={r.rx}
        stroke="currentColor"
        strokeWidth={1.2}
        fill={filled ? "currentColor" : "none"}
        fillOpacity={filled ? 0.12 : 0}
      />
    </svg>
  );
}
