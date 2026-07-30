export interface AccountCapabilities {
  password_login: boolean;
  password_register: boolean;
  email_verification: boolean;
}

export async function fetchAccountCapabilities(): Promise<AccountCapabilities> {
  const response = await fetch("/api/auth/capabilities");
  if (!response.ok) {
    throw new Error("账户能力读取失败");
  }
  const envelope = (await response.json()) as {
    code?: number;
    data?: Partial<AccountCapabilities>;
  };
  if (envelope.code !== 200 || !envelope.data) {
    throw new Error("账户能力响应无效");
  }
  return {
    password_login: envelope.data.password_login === true,
    password_register: envelope.data.password_register === true,
    email_verification: envelope.data.email_verification === true,
  };
}
