
export function creditsExpireAt(paidAt: Date, creditsValidMonths: number): Date {
  const expire = new Date(paidAt.getTime());
  expire.setMonth(expire.getMonth() + creditsValidMonths);
  return expire;
}
