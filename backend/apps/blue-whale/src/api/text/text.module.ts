import { Module } from "@nestjs/common";
import { TextCompletionsController } from "./text-completions.controller.js";

@Module({
  controllers: [TextCompletionsController],
})
export class TextApiModule {}
