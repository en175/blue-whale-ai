export function countPromptCharacters(prompt: string): number {
  return Array.from(prompt).filter((char) => !/\s/.test(char)).length;
}
