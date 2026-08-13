import { Module } from "@nestjs/common";
import { MeController } from "../me/me.controller.js";
import { AuthController } from "./auth.controller.js";

@Module({
  controllers: [AuthController, MeController],
})
export class AuthModule {}
