import {
  ASSET_ERROR_SPECS,
  SKILL_ERROR_SPECS,
  httpStatusForCode,
  messageOf,
  type AssetErrorName,
  type ErrorCodeSpec,
  type SkillErrorName,
} from "./error-codes.js";

export class DomainError extends Error {
  readonly code: number;
  readonly status: number;

  constructor(code: number, message?: string, status?: number) {
    super(message ?? messageOf(code));
    this.name = "DomainError";
    this.code = code;
    this.status = status ?? httpStatusForCode(code);
  }
}

export function assetError(name: AssetErrorName): DomainError {
  const spec: ErrorCodeSpec = ASSET_ERROR_SPECS[name];
  return new DomainError(spec.code, spec.message, spec.status);
}

export function skillError(name: SkillErrorName, message?: string): DomainError {
  const spec: ErrorCodeSpec = SKILL_ERROR_SPECS[name];
  return new DomainError(spec.code, message ?? spec.message, spec.status);
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
