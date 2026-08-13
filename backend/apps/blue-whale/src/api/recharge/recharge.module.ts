import { Module } from "@nestjs/common";
import { RechargeController } from "./recharge.controller.js";

@Module({
  controllers: [RechargeController],
})
export class RechargeModule {}
