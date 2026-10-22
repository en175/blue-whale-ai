import { Global, Module } from "@nestjs/common";
import { CaptchaService } from "./captcha.service.js";

@Global()
@Module({
  providers: [CaptchaService],
  exports: [CaptchaService],
})
export class CaptchaModule {}
