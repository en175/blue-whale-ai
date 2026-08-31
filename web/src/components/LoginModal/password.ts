export const isRegisterPasswordValid = (password: string) =>
  password.length >= 8 && password.length <= 20;
