import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 锁定 Creative Skill 激活契约：同一 fixtures 在 Java / Python / TypeScript
// 三端必须以相同 snake_case wire shape 通过或被拒。对齐
// docs/specs/2026-07-24-creative-skill-activation-contract.md（IK3NHU）。

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/specs/fixtures/creative-skill-activation",
);

interface ManifestEntry {
  file: string;
  def: string;
}

interface Manifest {
  schema: string;
  valid: ManifestEntry[];
  invalid: ManifestEntry[];
}

function loadJson(relativePath: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(fixturesDir, relativePath), "utf-8"),
  );
}

const manifest = loadJson("manifest.json") as Manifest;
const schema = loadJson(manifest.schema) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validatorCache = new Map<string, ValidateFunction>();

function validatorFor(defName: string): ValidateFunction {
  let validate = validatorCache.get(defName);
  if (!validate) {
    validate = ajv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: schema.$defs,
      $ref: `#/$defs/${defName}`,
    });
    validatorCache.set(defName, validate);
  }
  return validate;
}

describe("creative-skill-activation contract fixtures", () => {
  for (const entry of manifest.valid) {
    it(`valid fixture conforms: ${entry.file}`, () => {
      const validate = validatorFor(entry.def);
      const ok = validate(loadJson(entry.file));
      expect(validate.errors).toBeNull();
      expect(ok).toBe(true);
    });
  }

  for (const entry of manifest.invalid) {
    it(`invalid fixture is rejected: ${entry.file}`, () => {
      const validate = validatorFor(entry.def);
      const ok = validate(loadJson(entry.file));
      expect(ok).toBe(false);
      expect(validate.errors).not.toBeNull();
    });
  }
});
