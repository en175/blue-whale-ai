import { Global, Module } from "@nestjs/common";
import { LoginEntryService } from "./login-entry.service.js";
import { SessionService } from "./session.service.js";

@Global()
@Module({
  providers: [SessionService, LoginEntryService],
  exports: [SessionService, LoginEntryService],
})
export class SessionModule {}
