import { isPasswordSettable } from '@/lib/password';

/**
 * 注册口令是否合规。
 *
 * ⚠️ 规则本体在 `@/lib/password` ——这里只是这个表单的**别名**。
 * 曾经这条规则在这个文件与 `PasswordModal/password.ts` 里各写了一遍，
 * 改一处而漏另一处就是「注册能过、改密过不了」。
 */
export const isRegisterPasswordValid = isPasswordSettable;
