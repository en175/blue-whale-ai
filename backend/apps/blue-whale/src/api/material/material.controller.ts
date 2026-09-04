// 素材库透传镜像：POST /api/material/{Action}（对齐上游网关对外入口形状）。
// - 鉴权：全局 AuthGuard 按登录会话校验并回注 Bearer sk-，本控制器不自建鉴权。
// - Action 白名单在 MaterialService；请求体（含真人会话 callback_url，由前端传入）原样透传。
// - 上游状态码与信封（ResponseMetadata/Result、ResponseError、真人会话直接格式）
//   经 @Res 原样回传；因此类级 @BypassTransform，避免被统一信封二次包裹。
// - 产品侧错误（非法 Action/缺凭证/未配置/网关不可达）抛 NewApiError，
//   由 AllExceptionsFilter 统一成产品 {code, msg, data} 信封。
import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { MaterialService } from "@lib/shared/material/material.service.js";

@Controller("material")
@BypassTransform()
export class MaterialController {
  constructor(private readonly material: MaterialService) {}

  @Post(":action")
  async callAction(
    @Param("action") action: string,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const upstream = await this.material.callAction(authorization, action, body);
    res.status(upstream.status).json(upstream.body);
  }
}
