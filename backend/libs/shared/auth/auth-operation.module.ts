import { Global, Module } from "@nestjs/common";
import { AuthOperationService } from "./auth-operation.service.js";

@Global()
@Module({
  providers: [AuthOperationService],
  exports: [AuthOperationService],
})
export class AuthOperationModule {}
