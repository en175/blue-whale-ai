import { Global, Module } from "@nestjs/common";
import { SessionService } from "./session.service.js";

/** 全局会话服务（AuthGuard / AuthController 共享）。 */
@Global()
@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
