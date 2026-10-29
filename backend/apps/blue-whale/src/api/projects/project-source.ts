export const PROJECT_SOURCES = ["dialog", "canvas"] as const;

export type ProjectSource = (typeof PROJECT_SOURCES)[number];

export type ProjectSourceParse =
  | { ok: true; source?: ProjectSource }
  | { ok: false; reason: string };

export function parseProjectSource(value: unknown): ProjectSourceParse {
  if (value === undefined || value === null || value === "") return { ok: true };
  if (value === "dialog" || value === "canvas") return { ok: true, source: value };
  return { ok: false, reason: "source 仅支持 dialog/canvas" };
}
