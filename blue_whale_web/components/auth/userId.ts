/**
 * 前端 userId 生成与 phone→uid 映射（纯前端 mock，后端不参与）。
 *
 * - generateUserId()：优先 crypto.randomUUID()，回退 Math.random，带 "U-" 前缀。
 * - resolveUserId(phone)：查 bw-phone-id-map → 命中复用，未命中生成并绑定。
 * - 映射持久化在 localStorage key "bw-phone-id-map"，登出不清理（同一手机号跨会话复用）。
 */

const PHONE_ID_MAP_KEY = "bw-phone-id-map";

/** 生成形如 "U-A1B2C3D4" 的前端用户标识 */
export function generateUserId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    const seg = crypto.randomUUID().split("-")[0];
    return `U-${seg.toUpperCase()}`;
  }
  // fallback（SSR 或 crypto 不可用）
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `U-${rand}`;
}

function loadPhoneIdMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PHONE_ID_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function savePhoneIdMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PHONE_ID_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * 根据手机号获取或创建 uid。
 * - 命中：返回已绑定的 uid
 * - 未命中：生成新 uid、写入映射、返回
 */
export function resolveUserId(phone: string): string {
  const map = loadPhoneIdMap();
  if (map[phone]) return map[phone];
  const uid = generateUserId();
  map[phone] = uid;
  savePhoneIdMap(map);
  return uid;
}

/**
 * 检查新手机号是否已被其他 uid 绑定。
 * - sameUserId：忽略与当前 uid 相同的记录（允许"重绑到同一个 uid"）
 * - 返回 true 表示已被占用（不同 uid 绑定过此手机号）
 */
export function isPhoneBound(newPhone: string, sameUserId?: string): boolean {
  const map = loadPhoneIdMap();
  const boundUid = map[newPhone];
  if (!boundUid) return false;
  if (sameUserId && boundUid === sameUserId) return false;
  return true;
}

/**
 * 换绑手机号：oldPhone → newPhone，保留 uid 不变。
 * - 删除 oldPhone 映射
 * - 写入 newPhone → uid 映射
 */
export function rebindPhone(oldPhone: string, newPhone: string, userId: string): void {
  const map = loadPhoneIdMap();
  delete map[oldPhone];
  map[newPhone] = userId;
  savePhoneIdMap(map);
}
