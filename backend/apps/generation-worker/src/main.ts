import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { GenerationWorkerModule } from "./generation-worker.module.js";

const port = Number.parseInt(
  process.env.GENERATION_WORKER_PORT ?? "4002",
  10,
);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(GenerationWorkerModule);
  await app.listen(port, process.env.HOST ?? "0.0.0.0");
  console.log(`[generation-worker] listening on :${port}`);
}

void bootstrap();
