import { Injectable } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import {
  createRechargeCustomConfigRepo,
  type RechargeCustomConfigRepo,
  type RechargeCustomConfigView,
  type SaveRechargeCustomConfigInput,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  canPurchaseCustom,
  customDeniedHint,
  validateCustomConfig,
} from "./constants.js";

@Injectable()
export class RechargeCustomService {
  private repoInstance?: RechargeCustomConfigRepo;

  private get repo(): RechargeCustomConfigRepo {
    if (!this.repoInstance) {
      this.repoInstance = createRechargeCustomConfigRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  async requireConfig(): Promise<RechargeCustomConfigView> {
    const config = await this.repo.get();
    if (!config) {
      throw new NewApiError(
        "自定义充值配置缺失：该环境未初始化 recharge_custom_config",
        503,
        "recharge_custom_unconfigured",
      );
    }
    return config;
  }

  async saveConfig(input: SaveRechargeCustomConfigInput): Promise<RechargeCustomConfigView> {
    const current = await this.requireConfig();
    const next = {
      minCredits: input.minCredits ?? current.minCredits,
      maxCredits: input.maxCredits ?? current.maxCredits,
      defaultCredits: input.defaultCredits ?? current.defaultCredits,
      creditsPerYuan: input.creditsPerYuan ?? current.creditsPerYuan,
      stepCredits: input.stepCredits ?? current.stepCredits,
    };
    const invalid = validateCustomConfig(next);
    if (invalid) {
      throw new NewApiError(invalid, 400);
    }
    return this.repo.save(input);
  }

  async buildOffer(userId: number | null): Promise<CustomRechargeOffer> {
    const config = await this.requireConfig();
    return {
      enabled: config.enabled,
      minCredits: config.minCredits,
      maxCredits: config.maxCredits,
      defaultCredits: config.defaultCredits,
      stepCredits: config.stepCredits,
      creditsPerYuan: config.creditsPerYuan,
      creditsValidMonths: config.creditsValidMonths,
      canPurchase: userId === null ? null : canPurchaseCustom(config, userId),
      deniedHint: customDeniedHint(config),
    };
  }
}

export interface CustomRechargeOffer {
  enabled: boolean;
  minCredits: number;
  maxCredits: number;
  defaultCredits: number;
  stepCredits: number;
  creditsPerYuan: number;
  creditsValidMonths: number;
  canPurchase: boolean | null;
  deniedHint: string;
}
