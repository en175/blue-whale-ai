export interface RechargeCustomConfig {
  enabled: boolean;
  min_credits: number;
  max_credits: number;
  default_credits: number;
  step_credits: number;
  credits_per_yuan: number;
  credits_valid_months: number;
  can_purchase: boolean | null;
  denied_hint: string;
}
