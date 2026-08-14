import { Global, Module } from "@nestjs/common";
import { SceneCardResourceService } from "./scene-card.service.js";

@Global()
@Module({
  providers: [SceneCardResourceService],
  exports: [SceneCardResourceService],
})
export class SceneCardModule {}
