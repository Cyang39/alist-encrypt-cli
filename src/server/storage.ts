interface CacheEntry<T> {
  value: T;
  expiresAt: number | null; // null = permanent
}

const store = new Map<string, CacheEntry<unknown>>();

// 每 30 秒清理过期条目
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}, 30_000);

/**
 * 存储值，可选 TTL（毫秒）
 */
export function set<T>(key: string, value: T, ttlMs?: number): void {
  store.set(key, {
    value,
    expiresAt: ttlMs != null ? Date.now() + ttlMs : null,
  });
}

/**
 * 获取值，过期或不存在返回 null
 */
export function get<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

/**
 * 删除值
 */
export function del(key: string): void {
  store.delete(key);
}

// === 便捷方法 ===

const FILE_INFO_TTL = 24 * 60 * 60 * 1000; // 24h
const REDIRECT_TTL = 72 * 60 * 60 * 1000; // 72h

export function cacheFileInfo(path: string, info: unknown): void {
  set(`fileInfo:${decodeURIComponent(path)}`, info, FILE_INFO_TTL);
}

export function getFileInfo(path: string): Record<string, unknown> | null {
  return get(`fileInfo:${decodeURIComponent(path)}`);
}

export function cacheRedirect(
  key: string,
  data: { url: string; passwdInfo: unknown; fileSize: number },
): void {
  set(`redirect:${key}`, data, REDIRECT_TTL);
}

export function getRedirect(
  key: string,
): { url: string; passwdInfo: unknown; fileSize: number } | null {
  return get(`redirect:${key}`);
}
