import { Global, Module } from "@nestjs/common";
import { AccountService } from "./account.service.js";

@Global()
@Module({
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
