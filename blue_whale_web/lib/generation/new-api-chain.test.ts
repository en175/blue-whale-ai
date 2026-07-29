import { describe, expect, it, vi } from "vitest";

import { createNewApiClient } from "@blue-whale/core";
import { createGenerationImageProvider } from "./worker/ark-image-provider";

describe("new-api generation chain", () => {
  it("logs in, reads quota, then generates through the same sk token", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (input: string) => {
      calls.push(input);
      if (input.endsWith("/api/user/login")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { id: 9, username: "alice", token: "sk-chain" },
          }),
          { status: 200 },
        );
      }
      if (input.endsWith("/api/usage/token/")) {
        return new Response(
          JSON.stringify({ code: true, data: { user_quota: 800000 } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ data: [{ url: "https://cdn.test/chain.png" }] }),
        { status: 200 },
      );
    });
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl,
    });

    const login = await client.login({ username: "alice", password: "secret" });
    const usage = await client.getTokenUsage(login.token);
    const images = await createGenerationImageProvider({
      env: { NEW_API_BASE_URL: "http://new-api.test" },
      token: login.token,
      fetchImpl,
    }).generate({ model: "image-model", prompt: "a whale", n: 1 });

    expect(login.token).toBe("sk-chain");
    expect(usage.userQuota).toBe(800000);
    expect(images[0]?.url).toBe("https://cdn.test/chain.png");
    expect(calls).toEqual([
      "http://new-api.test/api/user/login",
      "http://new-api.test/api/usage/token/",
      "http://new-api.test/v1/images/generations",
    ]);
    expect(
      new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer sk-chain");
  });
});
