import { describe, expect, it } from "vitest";

import {
  loadGenerationCredentialSecret,
  openGenerationCredential,
  sealGenerationCredential,
} from "./generation-credential";

describe("generation provider credential", () => {
  it("round-trips an encrypted token without storing the plaintext", async () => {
    const module = await import("./generation-credential.js").catch(() => ({}));
    const seal = (
      module as {
        sealGenerationCredential?: (token: string, secret: string) => string;
      }
    ).sealGenerationCredential;
    const open = (
      module as {
        openGenerationCredential?: (
          ciphertext: string,
          secret: string,
        ) => string;
      }
    ).openGenerationCredential;

    expect(seal).toBeTypeOf("function");
    expect(open).toBeTypeOf("function");
    if (!seal || !open) return;

    const ciphertext = seal("sk-user-secret", "worker-shared-secret");

    expect(ciphertext).not.toContain("sk-user-secret");
    expect(open(ciphertext, "worker-shared-secret")).toBe("sk-user-secret");
    expect(() => open(ciphertext, "wrong-secret")).toThrow();
  });

  it("uses only the dedicated secret for producer/consumer round trips", () => {
    const secret = loadGenerationCredentialSecret({
      GENERATION_CREDENTIAL_SECRET: "dedicated-generation-secret",
    });
    const ciphertext = sealGenerationCredential("sk-user-token", secret);

    expect(openGenerationCredential(ciphertext, secret)).toBe("sk-user-token");
    expect(() =>
      loadGenerationCredentialSecret({
        JWT_SECRET: "legacy-java-jwt-secret-at-least-16",
      }),
    ).toThrow("GENERATION_CREDENTIAL_SECRET");
  });
});
