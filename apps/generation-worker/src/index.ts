import { readinessResponseSchema } from "@blue-whale/contracts";
import {
  checkReadiness,
  loadGenerationCredentialSecret,
  openGenerationCredential,
} from "@blue-whale/core";
import {
  createFakeGenerationAdapter,
  createNewApiVideoTaskProvider,
  createPassthroughVideoMediaRelay,
  createTosVideoMediaRelay,
  loadGenerationMediaRelayMode,
  loadGenerationTosConfig,
  runVideoJobStep,
  runVideoWorkerLoop,
} from "@blue-whale/generation-runtime";
import { createWorkerRepo, getPrismaClient } from "@blue-whale/persistence";
import { createServer } from "node:http";
import { hostname } from "node:os";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required");

const prisma = getPrismaClient(databaseUrl);
const repo = createWorkerRepo(prisma);
const runtimeMode =
  process.env.GENERATION_RUNTIME_MODE ??
  (process.env.NEW_API_BASE_URL ? "new-api" : "fake");
const fakeRuntime = createFakeGenerationAdapter();
const mysql = {
  name: "mysql",
  async check() {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      return true;
    } catch {
      return false;
    }
  },
};

let stopping = false;
let loop: Promise<void> = Promise.resolve();
let runtime = fakeRuntime;

if (runtimeMode === "new-api") {
  const baseUrl = process.env.NEW_API_BASE_URL;
  const mediaRelayMode = loadGenerationMediaRelayMode();
  const tosConfig =
    mediaRelayMode === "passthrough" ? null : loadGenerationTosConfig();
  const credentialSecret = loadGenerationCredentialSecret();
  if (!baseUrl) throw new Error("NEW_API_BASE_URL required");
  if (mediaRelayMode === "tos" && !tosConfig) {
    throw new Error("TOS configuration required");
  }

  const mediaRelay =
    mediaRelayMode === "passthrough"
      ? createPassthroughVideoMediaRelay()
      : createTosVideoMediaRelay(tosConfig!);
  const workerId = `generation-${hostname()}-${process.pid}`;
  runtime = {
    name: "new-api-video-runtime",
    async ready() {
      return true;
    },
    async generate() {
      throw new Error("new-api runtime uses durable video job steps");
    },
  };
  loop = runVideoWorkerLoop({
    shouldStop: () => stopping,
    runStep: async () => {
      try {
        return await runVideoJobStep({
          repo,
          workerId,
          createProvider: (token) =>
            createNewApiVideoTaskProvider({ baseUrl, token }),
          credentialVault: {
            open: (ciphertext) =>
              openGenerationCredential(ciphertext, credentialSecret),
          },
          mediaRelay,
        });
      } catch (error) {
        console.error(
          "[generation-worker] step failed:",
          error instanceof Error ? error.message : "unknown",
        );
        return null;
      }
    },
  });
} else if (runtimeMode !== "fake") {
  throw new Error(`Unsupported GENERATION_RUNTIME_MODE: ${runtimeMode}`);
}

const server = createServer((request, response) => {
  void (async () => {
    if (request.method !== "GET" || request.url !== "/ready") {
      response.writeHead(404).end();
      return;
    }

    const report = readinessResponseSchema.parse(
      await checkReadiness("generation-worker", [
        mysql,
        { name: runtime.name, check: () => runtime.ready() },
      ]),
    );
    response.writeHead(report.status === "ready" ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(report));
  })().catch(() => response.writeHead(500).end());
});

async function shutdown(): Promise<void> {
  stopping = true;
  await loop;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}

server.listen(
  Number.parseInt(process.env.PORT ?? "4002", 10),
  process.env.HOST ?? "0.0.0.0",
);
