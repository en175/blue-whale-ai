export { IdentityModule } from "./identity.module.js";
export { AccountDirectoryService } from "./account-directory.service.js";
export { PhoneBindingService } from "./phone-binding.service.js";
export {
  IdentityService,
  AccountDeletedError,
  AccountDisabledError,
  CodeAttemptsExhaustedError,
  CodeExpiredError,
  CodeWrongError,
  InvalidCredentialsError,
  MigrationIneligibleError,
  NicknameInvalidError,
  PhoneAlreadyBoundError,
  PhoneNotBoundError,
  RebindBindingChangedError,
  RebindSamePhoneError,
  type AccountFlags,
  type LocalLoginResult,
} from "./identity.service.js";
export { PhoneActionService, type PhoneActionKind } from "./phone-action.service.js";
export { PasswordPolicyError } from "./password.js";

export { LastSuperAdminError } from "@lib/core/identity/roles.js";
export type { Tier } from "@lib/core/identity/tier.js";

export { UnknownRoleError } from "@lib/shared/persistence/identity-role-repo.js";
export {
  PhoneTakenError,
  UsernameTakenError,
  USER_STATUS_DISABLED,
  USER_STATUS_NORMAL,
  type IdentityUserStatus,
} from "@lib/shared/persistence/identity-user-repo.js";
export type {
  AdminUserListOptions,
  AdminUserRow,
} from "@lib/shared/persistence/admin-user-query.js";
