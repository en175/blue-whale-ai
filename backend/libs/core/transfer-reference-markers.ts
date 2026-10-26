
const MARKER_SOURCE = "&([1-9][0-9]*|asset-[^&\\s]{1,128})&";
const markerPattern = () => new RegExp(MARKER_SOURCE, "gi");

export function transferReferenceMarkers(
  prompt: string,
  labels: ReadonlyMap<string, string>,
): string {
  if (labels.size === 0) return prompt;
  const lower = new Map<string, string>();
  for (const [key, value] of labels) {
    if (!lower.has(key.toLowerCase())) lower.set(key.toLowerCase(), value);
  }
  return prompt.replace(markerPattern(), (whole, identity: string) => {
    const label = labels.get(identity)
      ?? (identity.toLowerCase().startsWith("asset-") ? lower.get(identity.toLowerCase()) : undefined);
    return label === undefined ? whole : `@${label}`;
  });
}
