import { Global, Module } from "@nestjs/common";
import { SnapshotService } from "./snapshot.service.js";

@Global()
@Module({
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class SnapshotModule {}
