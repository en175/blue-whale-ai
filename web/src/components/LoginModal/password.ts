export const isRegisterPasswordValid = (password: string) =>
  password.length >= 9 && password.length <= 20;
