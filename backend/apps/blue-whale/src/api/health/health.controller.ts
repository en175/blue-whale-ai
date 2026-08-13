import { Controller, Get } from "@nestjs/common";
import { Public } from "@lib/infra/decorators/public.decorator.js";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check(): { status: string } {
    return { status: "ok" };
  }
}
