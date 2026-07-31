/**
 * IK5JV6 共享内联 SVG 占位图(从 productImport.svgPlaceholder / cardLibrary.svgCover
 * 两处逐字相同的实现提取):320×180 双色相渐变 + 居中标签,合法 data-URL,无网络依赖。
 */

/** 内联 SVG 占位图(hue 决定渐变主色相,label 居中显示)。 */
export function svgPlaceholder(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,28%)"/><stop offset="1" stop-color="hsl(${hue + 40},50%,16%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><text x="160" y="96" font-size="20" fill="rgba(255,255,255,0.75)" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
