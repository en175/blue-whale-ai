import { Module } from "@nestjs/common";
import { SceneCardsController } from "./scene-cards.controller.js";

@Module({
  controllers: [SceneCardsController],
})
export class SceneCardsApiModule {}
