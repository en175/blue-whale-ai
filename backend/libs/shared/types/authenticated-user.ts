export type AuthenticatedUser = {
  userId: string;
  status: "enabled";
  isAdmin: boolean;
  username: string;
  email: string | null;
};
