import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("ready")
  ready(): { status: string } {
    return { status: "ready" };
  }
}
