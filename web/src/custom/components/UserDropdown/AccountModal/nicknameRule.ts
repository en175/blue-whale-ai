export const NICKNAME_RULE_MESSAGE =
  '2—20个字符，仅支持中文、英文大小写字母、数字、下划线（_）和短横线（-）。';

const NICKNAME_CHARACTERS = /^[\p{Script=Han}A-Za-z0-9_-]+$/u;

export function nicknameValidationMessage(raw: string): string | null {
  const nickname = raw.trim();
  const length = Array.from(nickname).length;
  if (length < 2 || length > 20 || !NICKNAME_CHARACTERS.test(nickname)) {
    return NICKNAME_RULE_MESSAGE;
  }
  return null;
}
