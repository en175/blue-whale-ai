import { Global, Module } from "@nestjs/common";
import { PhoneActionService } from "./phone-action.service.js";

@Global()
@Module({
  providers: [PhoneActionService],
  exports: [PhoneActionService],
})
export class PhoneActionModule {}
