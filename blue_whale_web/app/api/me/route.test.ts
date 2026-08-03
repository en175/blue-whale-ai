import { describe, expect, it } from "vitest";

import { createMeHandler } from "./route";

describe("GET /api/me", () => {
  it("ignores client user ids and resolves the account from the bearer token", async () => {
    const GET = createMeHandler({
      resolveTokenIdentity: async (token: string) => {
        expect(token).toBe("sk-trusted");
        return {
          userId: 7,
          username: "alice",
          email: "alice@example.com",
          status: 1,
          role: 1,
        };
      },
    });
    const response = await GET(
      new Request("http://web.test/api/me?user_id=999", {
        headers: { Authorization: "Bearer sk-trusted" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      msg: null,
      data: {
        user_id: 7,
        username: "alice",
        email: "alice@example.com",
        phone: "",
        has_password: true,
      },
    });
  });
});
