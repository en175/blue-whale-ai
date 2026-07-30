import { describe, expect, it } from "vitest";

import { createCapabilitiesHandler } from "./route";

describe("GET /api/auth/capabilities", () => {
  it("projects only account features implemented by BlueWhale", async () => {
    const GET = createCapabilitiesHandler({
      getAccountCapabilities: async () => ({
        passwordLogin: true,
        passwordRegister: true,
        emailVerification: true,
      }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      msg: null,
      data: {
        password_login: true,
        password_register: true,
        email_verification: true,
      },
    });
  });
});
