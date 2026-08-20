// IK9VZ0：多退少补结算结果接收模块（new-api 端结算 → 蓝鲸端只记账，用户端零暴露）。
import { Module } from "@nestjs/common";
import {
  alignReservationBySettlement,
  createCostAdjustmentRepo,
} from "@blue-whale/persistence";
import { PrismaModule } from "@lib/shared/prisma/prisma.module.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { CostSettlementConsumer } from "@lib/shared/cost-reconciliation/cost-settlement-consumer.service.js";
import { CostSettlementInternalController } from "./cost-settlement.controller.js";

@Module({
  imports: [PrismaModule],
  controllers: [CostSettlementInternalController],
  providers: [
    {
      provide: CostSettlementConsumer,
      useFactory: (prisma: PrismaService) =>
        new CostSettlementConsumer({
          repo: createCostAdjustmentRepo(prisma.client),
          alignReservation: (jobId, item) =>
            alignReservationBySettlement(prisma.client, jobId, {
              actionType: item.action,
              amountFen: item.amountFen,
            }),
        }),
      inject: [PrismaService],
    },
  ],
})
export class CostSettlementModule {}
