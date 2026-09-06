/** Persistence limits, measured in UTF-16 code units except canvasBytes (UTF-8). */
export const PROMPT_TEXT_LIMITS = { text: 100_000, title: 200, canvasBytes: 4_194_304 } as const;
