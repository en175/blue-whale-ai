export interface CreditsLotPreview {
  remaining: number | null;
  expiresAt: string | null;
}

export interface CreditsSummary {
  balance: number | null;
  validityMonths: number | null;
  nearestLot: CreditsLotPreview | null;
}
