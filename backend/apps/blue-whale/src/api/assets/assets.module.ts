import { Module } from "@nestjs/common";
import { AssetsController } from "./assets.controller.js";
import { MaterialApiModule } from "../material/material.module.js";

@Module({
  imports: [MaterialApiModule],
  controllers: [AssetsController],
})
export class AssetsApiModule {}
