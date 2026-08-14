import { Global, Module } from "@nestjs/common";
import { OperationLogService } from "./operation-log.service.js";

@Global()
@Module({
  providers: [OperationLogService],
  exports: [OperationLogService],
})
export class OperationLogModule {}
