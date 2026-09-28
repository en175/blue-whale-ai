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

/**
 * 自定义充值配置（模块 B，PRD §7 / §10.3）。
 *
 * <p>这一层只做两件事：把配置读出来、把配置存回去（存之前按 {@link validateCustomConfig}
 * 校验整份口径）。**报价与落单不在这里** —— 下单链路在 `RechargeService.createOrder`
 * （复用同一条 `hold → 发放` 到账路径，不另起一条），这里只提供它需要的配置与权限判断。
 *
 * <p>⚠️ 配置行缺失时**抛 503，不静默回退到代码里的默认值**：PRD §6.1 明确要求商品配置
 * 「不在代码中写死」，在代码里再放一份 600/499995/15 的副本，等于让「后台配了多少」
 * 与「用户实际按多少算」有了两个可能的答案。行是迁移种下的，缺了就是环境坏了，
 * 要说出来（与 `SystemSettingsConfigError` 的处理同口径：配置缺失 → 503，不是 500）。
 */
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

  /** 读配置；行缺失 → 503（见类注释，不回退到代码默认值）。 */
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

  /**
   * 保存配置（管理端）。
   *
   * <p>校验的是**合并后的整份配置**，不是这次传进来的那几个字段 —— 只改换算率
   * 同样会让上下限不再整分（见 `validateCustomConfig`）。不合并就校验，等于放行
   * 一份「保存时报错、下单时才算不出来」的配置。
   */
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

  /**
   * 用户侧报价（PRD §7.2 展示项）。
   *
   * <p>`userId` 传 null = 游客：**可见不可买**（PRD §7.4）。游客能拿到全部展示项
   * （上下限、默认值、换算率、滑杆步长），只是 `canPurchase` 为 null —— 前端据此
   * 把按钮导向登录/注册，而不是把自定义充值整块藏起来。
   */
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

/** 用户侧的自定义充值报价（不含任何内部字段：版本号、白名单都不出去）。 */
export interface CustomRechargeOffer {
  /** 是否启用（PRD §10.3）。false = 用户侧不展示 */
  enabled: boolean;
  minCredits: number;
  maxCredits: number;
  defaultCredits: number;
  /** 滑杆步长（PRD §10.3） */
  stepCredits: number;
  /** 每元积分数（PRD §7.1 默认 15），前端据此实时算价 */
  creditsPerYuan: number;
  /** 到账积分有效期（月）。前端用来渲染「长期有效」那类文案 */
  creditsValidMonths: number;
  /** 当前用户能否购买；**null = 游客，未判定**（PRD §7.4 游客可见不可买） */
  canPurchase: boolean | null;
  /** 无权限时展示的文案（后台可配，未配则默认文案） */
  deniedHint: string;
}
