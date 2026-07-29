import { describe, expect, it } from "vitest";

describe("generation provider credential", () => {
  it("round-trips an encrypted token without storing the plaintext", async () => {
    const module = await import("./generation-credential.js").catch(() => ({}));
    const seal = (module as {
      sealGenerationCredential?: (token: string, secret: string) => string;
    }).sealGenerationCredential;
    const open = (module as {
      openGenerationCredential?: (ciphertext: string, secret: string) => string;
    }).openGenerationCredential;

    expect(seal).toBeTypeOf("function");
    expect(open).toBeTypeOf("function");
    if (!seal || !open) return;

    const ciphertext = seal("sk-user-secret", "worker-shared-secret");

    expect(ciphertext).not.toContain("sk-user-secret");
    expect(open(ciphertext, "worker-shared-secret")).toBe("sk-user-secret");
    expect(() => open(ciphertext, "wrong-secret")).toThrow();
  });
});
