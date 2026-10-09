import { http } from './http';

export interface AdminSessionData {
  userId: number;
  isAdmin: boolean;
}

export function fetchAdminSession() {
  return http.get<AdminSessionData>('/api/admin/session', { silent: true });
}
