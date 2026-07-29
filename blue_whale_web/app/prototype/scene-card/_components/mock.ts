// PROTOTYPE (IK4Q4E 场景卡画布交互与视觉原型) — mock 数据，评审后删除，勿合入生产路径。
// 内容形态按需求方截图批注：Scene 头 + Shot 分段 + 内联 asset chip（Image N）。

export const SAMPLE_MARKDOWN = `# Scene 01 · 15s

## Shot 1 | 0–2s · Wide Low Angle · Product Roll-in
Visual: The soundcore Nebula X1 Pro ![Image 1](asset://101) rolls smoothly into frame center on its built-in rugged wheels, satellite speakers deployed, front lens facing the screen. Golden-hour backyard patio — warm amber sunlight rakes across the matte black casing, sculpting a premium rim light along the edges. A single press on the control panel; the AI eye blinks on. Reference hero composition from Image 10 ![Image 10](asset://110).
Dialogue: None

## Shot 2 | 2–7s · Wide Establishing · Laser Proof Beat
Visual: The soundcore Nebula X1 Pro ![Image 1](asset://101) fires a massive 4K laser image forward onto the large inflatable screen ![Image 3](asset://103) — the beam travels away from camera toward the screen in the background. The projector's back panel faces the viewer as seen in Image 16 ![Image 16](asset://116). The screen erupts with impossibly sharp, color-saturated cinematic imagery.
VO: "4K triple laser. 400 watts of Dolby Atmos 7.1.4. Ready in five minutes."

## Shot 3 | 7–12s · Wide Establishing · Lifestyle Payoff
Visual: A group of friends settled in outdoor chairs, faces softly lit by the projected screen's warm glow. The soundcore Nebula X1 Pro ![Image 1](asset://101) sits behind them, back panel visible, satellite speakers firing overhead audio, as seen in Image 17 ![Image 17](asset://117). The large inflatable screen ![Image 3](asset://103) fills the background with vivid cinematic color. Stars emerging overhead.
VO: "The world's first mobile theater station."

## Shot 4 | 12–15s · 3/4 Hero Packshot · Brand Close
Visual: The soundcore Nebula X1 Pro ![Image 1](asset://101) in a clean 3/4 hero view, satellite speakers deployed, front lens glowing blue, anchored against a deep twilight sky — referencing the premium product identity from Image 10 ![Image 10](asset://110). Logo lockup fades in over clean negative space.
On-screen text: "soundcore Nebula X1 Pro" · "See Big. Feel Bigger."`;

/** 场景卡展示名：取首个一级标题，退化为「场景卡」。 */
export function cardDisplayName(markdown: string): string {
  const line = markdown.split("\n").find((l) => l.startsWith("# "));
  return line ? line.slice(2).trim() : "场景卡";
}

/** 从 Markdown 中提取 asset:// 引用（按出现顺序，去重）。 */
export function extractAssetRefs(
  markdown: string,
): { assetId: string; label: string }[] {
  const out: { assetId: string; label: string }[] = [];
  const seen = new Set<string>();
  const re = /!\[([^\]]*)\]\(asset:\/\/([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ label: m[1], assetId: m[2] });
  }
  return out;
}
