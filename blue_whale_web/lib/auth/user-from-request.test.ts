import { describe, expect, it } from "vitest";

import { getUserIdFromRequest } from "./user-from-request";

describe("getUserIdFromRequest", () => {
  it("accepts new-api sk tokens as a stable Node owner id", async () => {
    const request = new Request("http://web.test/api/projects", {
      headers: { Authorization: "Bearer sk-user-token" },
    });

    const first = await getUserIdFromRequest(request, "unused-secret");
    const second = await getUserIdFromRequest(request, "unused-secret");

    expect(first).toMatch(/^\d+$/);
    expect(first).toBe(second);
  });
});
