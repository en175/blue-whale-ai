import { describe, expect, it } from "vitest";

import { createRegisterHandler } from "./route";

describe("POST /api/auth/register", () => {
  it("registers through the account client and returns an immediate login state", async () => {
    const POST = createRegisterHandler({
      register: async () => ({
        token: "sk-register",
        userId: 8,
        username: "alice",
        email: "alice@example.com",
      }),
    });

    const response = await POST(
      new Request("http://web.test/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: "alice",
          password: "secret",
          email: "alice@example.com",
          verification_code: "123456",
          user_id: 999,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      code: 200,
      data: {
        access_token: "sk-register",
        user_id: 8,
        username: "alice",
        is_new_user: true,
      },
    });
  });
});
