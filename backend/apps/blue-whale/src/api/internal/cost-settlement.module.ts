import { Module } from "@nestjs/common";
import {
  alignReservationBySettlement,
  createCostAdjustmentRepo,
} from "@lib/shared/persistence/index.js";
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
