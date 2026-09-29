/** 书签与最近文件(localStorage 持久化)。 */

const BM_KEY = "mindbox-bookmarks";
const RECENT_KEY = "mindbox-recent";
const RECENT_MAX = 15;

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, v: string[]) {
  localStorage.setItem(key, JSON.stringify(v));
}

export const loadBookmarks = () => read(BM_KEY);

export function toggleBookmark(path: string): string[] {
  const v = read(BM_KEY);
  const i = v.indexOf(path);
  i >= 0 ? v.splice(i, 1) : v.unshift(path);
  write(BM_KEY, v);
  return v;
}

/** 删除文件/文件夹后同步清理书签(含其下所有子路径),防止书签永久悬空。 */
export function removeBookmarks(path: string): void {
  const v = read(BM_KEY);
  const next = v.filter((p) => p !== path && !p.startsWith(`${path}/`));
  if (next.length !== v.length) {
    write(BM_KEY, next);
    window.dispatchEvent(new Event("mindbox-bookmarks-changed"));
  }
}

/** 重命名/移动后同步迁移书签路径。 */
export function moveBookmarks(src: string, dst: string): void {
  const v = read(BM_KEY);
  let changed = false;
  const next = v.map((p) => {
    if (p === src) {
      changed = true;
      return dst;
    }
    if (p.startsWith(`${src}/`)) {
      changed = true;
      return dst + p.slice(src.length);
    }
    return p;
  });
  if (changed) {
    write(BM_KEY, next);
    window.dispatchEvent(new Event("mindbox-bookmarks-changed"));
  }
}

export const loadRecent = () => read(RECENT_KEY);

/** 记录打开(去重置顶,最多 15 条)。 */
export function pushRecent(path: string): string[] {
  const v = read(RECENT_KEY).filter((p) => p !== path);
  v.unshift(path);
  const out = v.slice(0, RECENT_MAX);
  write(RECENT_KEY, out);
  return out;
}
