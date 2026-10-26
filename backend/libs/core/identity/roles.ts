
export const ROLE_USER = "user";
export const ROLE_ADMIN = "admin";
export const ROLE_SUPER_ADMIN = "super_admin";

export const BUILTIN_ROLE_CODES: readonly string[] = [ROLE_USER, ROLE_ADMIN, ROLE_SUPER_ADMIN];

export const ADMIN_ROLE_CODES: readonly string[] = [ROLE_ADMIN, ROLE_SUPER_ADMIN];

export function isAdmin(roleCodes: readonly string[]): boolean {
  return roleCodes.some((code) => ADMIN_ROLE_CODES.includes(code));
}

export function isSuperAdmin(roleCodes: readonly string[]): boolean {
  return roleCodes.includes(ROLE_SUPER_ADMIN);
}

export function revokeWouldOrphanSuperAdmin(
  roleBeingRevoked: string,
  targetRoleCodes: readonly string[],
  superAdminHolderCount: number,
): boolean {
  return (
    roleBeingRevoked === ROLE_SUPER_ADMIN &&
    isSuperAdmin(targetRoleCodes) &&
    superAdminHolderCount <= 1
  );
}

export class LastSuperAdminError extends Error {
  constructor() {
    super("系统必须保留至少一个超级管理员：这是最后一个，撤销后将无人能进入管理端");
    this.name = "LastSuperAdminError";
  }
}

export function roleRank(roleCodes: readonly string[]): number {
  if (roleCodes.includes(ROLE_SUPER_ADMIN)) return 100;
  if (roleCodes.includes(ROLE_ADMIN)) return 10;
  return 1;
}
