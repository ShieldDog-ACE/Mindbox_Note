/**
 * Mindbox API 客户端。统一走 /api/v1,与后端版本化解耦。
 * 端口默认 8765,可用 VITE_MINDBOX_PORT 覆盖(联调时把前端指向另一个后端实例,
 * 避免和已在跑的 8765 抢端口)。
 */
const PORT = import.meta.env.VITE_MINDBOX_PORT || "8765";
export const API_BASE = `http://127.0.0.1:${PORT}/api/v1`;
const BASE = API_BASE;

async function request(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const get = (url: string) => request(url);
const post = (url: string, body: unknown) =>
  request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "note" | "canvas";
  children?: TreeNode[];
}

export interface GraphNode {
  id: string;
  name: string;
  degree?: number;
  missing?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  /** manual = 关系网里手动建立(可断开);canvas = 白板内连线派生(只能在白板里删) */
  kind?: "manual" | "canvas";
  /** kind=canvas 时,来源白板的路径 */
  from?: string;
}

export interface NoteData {
  path: string;
  name: string;
  content: string;
  meta: Record<string, unknown>;
}

export interface MemoryItem {
  id: string;
  layer: string;
  category: string;
  content: string;
  confidence: number;
  refs: number;
  success: number;
  fail: number;
}

export interface SearchSnippet {
  line: number;
  text: string;
}

export interface SearchResult {
  path: string;
  name: string;
  count: number;
  score: number;
  snippets: SearchSnippet[];
}

export interface Backlink {
  source: string;
  name: string;
  contexts: string[];
}

export interface Outlink {
  target: string;
  resolved: string | null;
}

export const api = {
  base: API_BASE,
  health: () => get(`${BASE}/system/health`) as Promise<{ ok: boolean }>,
  tree: () => get(`${BASE}/vault/tree`) as Promise<TreeNode[]>,
  graph: () => get(`${BASE}/vault/graph`) as Promise<{ nodes: GraphNode[]; links: GraphLink[] }>,
  readNote: (path: string) => get(`${BASE}/notes?path=${encodeURIComponent(path)}`) as Promise<NoteData>,
  deleteNote: (path: string) =>
    request(`${BASE}/notes?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  createNote: (path: string, content = "") => post(`${BASE}/notes`, { path, content }),
  saveNote: (path: string, content: string) =>
    request(`${BASE}/notes?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  resolve: (title: string) => get(`${BASE}/notes/resolve?title=${encodeURIComponent(title)}`) as Promise<{ path: string | null }>,
  rename: (path: string, newPath: string, updateLinks = true) =>
    post(`${BASE}/notes/rename`, { path, new_path: newPath, update_links: updateLinks }),
  backlinks: (path: string) => get(`${BASE}/notes/backlinks?path=${encodeURIComponent(path)}`) as Promise<Backlink[]>,
  outlinks: (path: string) => get(`${BASE}/notes/outlinks?path=${encodeURIComponent(path)}`) as Promise<Outlink[]>,
  createFolder: (path: string) => post(`${BASE}/vault/folder`, { path }),
  copyItem: (src: string, dst: string) => post(`${BASE}/vault/copy`, { src, dst }),
  createRelation: (source: string, target: string) => post(`${BASE}/vault/relations`, { source, target }),
  deleteRelation: (source: string, target: string) =>
    request(`${BASE}/vault/relations?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`, { method: "DELETE" }),
  tags: () => get(`${BASE}/vault/tags`) as Promise<Record<string, number>>,
  search: (q: string) => get(`${BASE}/search?q=${encodeURIComponent(q)}`) as Promise<SearchResult[]>,
  tagNotes: (tag: string) => get(`${BASE}/vault/tag-notes?tag=${encodeURIComponent(tag)}`) as Promise<{ path: string; name: string }[]>,
  saveImage: (name: string, dataB64: string) => post(`${BASE}/vault/image`, { name, data: dataB64 }) as Promise<{ path: string; name: string }>,
  mediaUrl: (target: string) => `${BASE}/vault/media?path=${encodeURIComponent(target)}`,
  snapshots: (path: string) => get(`${BASE}/snapshots?path=${encodeURIComponent(path)}`) as Promise<{ ts: string; mtime: number; size: number }[]>,
  snapshotFiles: () => get(`${BASE}/snapshots/files`) as Promise<{ path: string; exists: boolean; count: number; latest: number }[]>,
  readSnapshot: (path: string, ts: string) =>
    get(`${BASE}/snapshots/read?path=${encodeURIComponent(path)}&ts=${encodeURIComponent(ts)}`) as Promise<{ content: string }>,
  restoreSnapshot: (path: string, ts: string) => post(`${BASE}/snapshots/restore`, { path, ts }),
  memorySummary: () => get(`${BASE}/memory/summary`) as Promise<Record<string, number>>,
  memoryItems: (layer: string) => get(`${BASE}/memory/${layer}`) as Promise<MemoryItem[]>,
  addMemory: (layer: string, category: string, content: string) => post(`${BASE}/memory/${layer}`, { category, content }),
  /** 导出全部笔记为 zip(返回 Blob 供下载)。 */
  exportZip: async () => {
    const res = await fetch(`${BASE}/vault/export`);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.blob();
  },
  /** 导入 zip:全部作为新增写入(重名自动改名),不覆盖。 */
  importZip: async (file: Blob) => {
    const res = await fetch(`${BASE}/vault/import`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: file,
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ imported: number; skipped: number }>;
  },
};
