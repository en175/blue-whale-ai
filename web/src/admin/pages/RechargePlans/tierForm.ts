/** 档位表单本地校验：原价正整数、折扣 ∈ (0, 1]。非法返回文案，合法返回 null。 */
export function tierFormError(priceNum: number, ratioNum: number): string | null {
  if (!Number.isInteger(priceNum) || priceNum <= 0) return '原价须为正整数';
  if (ratioNum <= 0 || ratioNum > 1) return '折扣比例须在 (0, 1] 之间';
  return null;
}
