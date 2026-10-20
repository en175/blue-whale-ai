import { Body, Controller, Get, HttpException, Inject, Param, Put, Res } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { LocalCanvasRecoveryService } from "@lib/shared/canvas/local-canvas-recovery.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { Response } from "express";

@Controller("canvases/:sourceProjectId/local-recoveries/:operationId")
export class LocalCanvasRecoveryController {
  constructor(@Inject(LocalCanvasRecoveryService) private readonly recovery: LocalCanvasRecoveryService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Param("sourceProjectId") sourceProjectId: string, @Param("operationId") operationId: string, @Res() res: Response) {
    return this.respond(res, this.recovery.get(user.userId, sourceProjectId, operationId));
  }

  @Put()
  restore(@CurrentUser() user: AuthenticatedUser, @Param("sourceProjectId") sourceProjectId: string, @Param("operationId") operationId: string, @Body() body: unknown, @Res() res: Response) {
    return this.respond(res, this.recovery.restore(user.userId, sourceProjectId, operationId, body));
  }

  private async respond(res: Response, result: Promise<unknown>) {
    try {
      res.status(200).json(await result);
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse();
        if (body && typeof body === "object" && "code" in body && "data" in body) {
          res.status(error.getStatus()).json(body);
          return;
        }
      }
      throw error;
    }
  }
}
