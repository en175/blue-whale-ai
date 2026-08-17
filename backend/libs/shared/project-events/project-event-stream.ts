import type {
  ProductEventRepo,
  ProductEventView,
} from "@blue-whale/persistence";
import { wireInteger } from "@lib/shared/wire-integer.js";

const encoder = new TextEncoder();

function wirePayload(value: unknown, key?: string): unknown {
  if (
    typeof value === "string" &&
    /^[0-9]+$/.test(value) &&
    key?.endsWith("_id")
  ) {
    return wireInteger(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => wirePayload(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        wirePayload(child, childKey),
      ]),
    );
  }
  return value;
}

function eventFrame(event: ProductEventView): Uint8Array {
  const envelope = {
    schema_version: 1,
    event_id: event.event_id,
    event_type: event.event_type,
    cursor: wireInteger(event.cursor),
    project_id: wireInteger(event.project_id),
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    aggregate_version: event.aggregate_version,
    correlation_id: event.correlation_id,
    causation_id: event.causation_id,
    occurred_at: event.occurred_at,
    payload: wirePayload(event.payload),
  };
  return encoder.encode(
    `id: ${event.cursor}\nevent: ${event.event_type}\ndata: ${JSON.stringify(envelope)}\n\n`,
  );
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}

export function createProjectEventStream(input: {
  projectId: string;
  after: string;
  events: ProductEventRepo;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
}): ReadableStream<Uint8Array> {
  const abort = new AbortController();
  const forwardAbort = () => abort.abort();
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (input.signal?.aborted) forwardAbort();
  const cleanup = () =>
    input.signal?.removeEventListener("abort", forwardAbort);
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let cursor = input.after;
        let lastWrite = Date.now();
        while (!abort.signal.aborted) {
          const events = await input.events.listAfter(
            input.projectId,
            cursor,
            100,
          );
          if (events.length > 0) {
            for (const event of events) {
              if (abort.signal.aborted) break;
              controller.enqueue(eventFrame(event));
              cursor = event.cursor;
              lastWrite = Date.now();
            }
            continue;
          }
          if (Date.now() - lastWrite >= (input.heartbeatIntervalMs ?? 15_000)) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            lastWrite = Date.now();
          }
          await delay(input.pollIntervalMs ?? 250, abort.signal);
        }
        if (!closed) {
          closed = true;
          controller.close();
        }
        cleanup();
      })().catch((error) => {
        cleanup();
        if (!closed) {
          closed = true;
          controller.error(error);
        }
      });
    },
    cancel() {
      closed = true;
      abort.abort();
      cleanup();
    },
  });
}
