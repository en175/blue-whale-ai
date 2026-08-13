export type AuthenticatedUser = {
  userId: string;
  status: "enabled";
  isAdmin: boolean;
  /** new-api 账户用户名，操作日志 operator 展示用。 */
  username: string;
};
