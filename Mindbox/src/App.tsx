import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, NoteData, TreeNode } from "./lib/api";
import Sidebar from "./components/Sidebar";
import NoteView from "./components/NoteView";
import RightPanel from "./components/RightPanel";
import CommandPalette, { Command } from "./components/CommandPalette";
import GraphView from "./components/GraphView";
import CanvasBoard from "./components/CanvasBoard";
import StatusBar from "./components/StatusBar";
import SettingsModal, { applySettings, loadSettings } from "./components/SettingsModal";
import SearchView from "./components/SearchView";
import { editorRegistry } from "./components/Editor";
import { Heading } from "./lib/md";
import { loadRecent, pushRecent, removeBookmarks, moveBookmarks } from "./lib/store";

type TabKind = "note" | "canvas" | "graph" | "search";

export interface Tab {
  id: string;
  kind: TabKind;
  path?: string;
  name: string;
  content?: string;
  meta?: Record<string, unknown>;
}

interface Pane {
  id: string;
  tabs: Tab[];
  active: string | null;
  mode: "edit" | "preview";
}

export function flattenTree(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    if (n.type !== "dir") out.push(n);
    if (n.children) flattenTree(n.children, out);
  }
  return out;
}

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
/** 新建文件用的短随机后缀。原来的 `Date.now() % 10000` 在 10 秒窗口内会重复,
 *  连按两次 Ctrl+N 撞名 → 后端 409,且没有捕获,表现为"点了没反应"。 */
const stamp = () => Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 1296).toString(36);
const initialCanvas = JSON.stringify({ nodes: [], edges: [] }, null, 2);
const baseName = (p: string) => p.split("/").pop()!.replace(/\.(md|canvas)$/, "");

/** 保存信号:状态栏显示时间 + 白板显示"已保存" + 图谱判断是否需要刷新。 */
export interface SaveTick {
  n: number;
  path: string;
}

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panes, setPanes] = useState<Pane[]>([{ id: "p1", tabs: [], active: null, mode: "edit" }]);
  const [activePane, setActivePane] = useState(0);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [panelOpen, setPanelOpen] = useState(false); // 右侧面板默认收起
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("mindbox-sidebar") !== "0"); // 左侧栏默认展开
  // 启动即应用持久化设置(主题/字体/动效等 CSS 变量)
  useEffect(() => {
    applySettings(loadSettings());
  }, []);
  const [saveTick, setSaveTick] = useState<SaveTick>({ n: 0, path: "" }); // 状态栏/白板保存信号
  const [searchSeed, setSearchSeed] = useState({ q: "", n: 0 });
  // 结构性变更版本号:新建/重命名/删除/移动/导入 + 每次内容落盘都会自增。
  // 关系图谱订阅它,变化时静默重拉(保留节点位置),没有变更就不会重载。
  const [vaultRev, setVaultRev] = useState(0);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const dragTab = useRef<{ paneId: string; tabId: string } | null>(null);
  const panesRef = useRef(panes); // 供删除/重命名时读取最新内容,防闭包过期
  panesRef.current = panes;

  const refreshTree = useCallback(() => {
    setVaultRev((v) => v + 1); // 一切结构性变更都经过这里,图谱共用同一信号
    return api.tree().then(setTree).catch(console.error);
  }, []);

  // 启动首次加载:后端(Electron sidecar)启动需数秒,失败有界重试直到就绪,否则树永远空白
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const load = () => {
      api
        .tree()
        .then((t) => {
          if (alive) setTree(t);
        })
        .catch(() => {
          if (alive && tries++ < 40) window.setTimeout(load, 750);
        });
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  // 图谱等视图新建/变更文件后,通知文件树刷新
  useEffect(() => {
    const onVaultChanged = () => refreshTree();
    window.addEventListener("mindbox-vault-changed", onVaultChanged);
    return () => window.removeEventListener("mindbox-vault-changed", onVaultChanged);
  }, [refreshTree]);

  // 图谱「建立/解除关系」直接改写笔记文件后,同步到已打开的标签(并清掉待存定时器),防编辑器旧内容回写覆盖
  useEffect(() => {
    const onNoteChanged = (e: Event) => {
      const { path, content } = (e as CustomEvent<{ path: string; content: string }>).detail ?? {};
      if (!path || typeof content !== "string") return;
      saveTimers.current.delete(path);
      setPanes((prev) =>
        prev.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.path === path ? { ...t, content } : t)) }))
      );
    };
    window.addEventListener("mindbox-note-changed", onNoteChanged);
    return () => window.removeEventListener("mindbox-note-changed", onNoteChanged);
  }, []);

  // 关闭窗口前:把所有还没落盘的防抖修改补发出去(页面卸载期间仍会送达)
  useEffect(() => {
    const onBeforeUnload = () => {
      for (const [path, timer] of saveTimers.current) {
        window.clearTimeout(timer);
        const pane = panesRef.current.find((p) => p.tabs.some((x) => x.path === path));
        const tab = pane?.tabs.find((x) => x.path === path);
        if (tab?.content !== undefined) {
          // 必须用 PUT(保存接口)。旧实现用 sendBeacon 打 POST /notes,那是"创建"接口,
          // overwrite 默认 false —— 对已存在的笔记一律 409,于是关窗时防抖窗口内的
          // 最后一段修改被静默丢弃。fetch(keepalive) 与 sendBeacon 语义等价但支持 PUT。
          try {
            void fetch(`${api.base}/notes?path=${encodeURIComponent(path)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: tab.content }),
              keepalive: true,
            });
          } catch {
            /* 卸载途中失败无法挽回 */
          }
        }
      }
      saveTimers.current.clear();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const activeTab = useMemo(() => {
    const p = panes[activePane] ?? panes[0];
    return p?.tabs.find((t) => t.id === p.active) ?? null;
  }, [panes, activePane]);

  /** 把路径变成标签(在当前分屏);已开则激活并刷新内容。graph://global / search://global 为伪路径。 */
  const openTab = useCallback((path: string, opts?: { pane?: number }) => {
    const kindOf = (p: string): TabKind =>
      p === "graph://global" ? "graph" : p === "search://global" ? "search" : p.endsWith(".canvas") ? "canvas" : "note";
    const kind = kindOf(path);
    const pseudoName: Partial<Record<TabKind, string>> = { graph: "关系图谱", search: "搜索" };
    setPanes((prev) => {
      const pi = Math.min(opts?.pane ?? activePane, prev.length - 1);
      return prev.map((p, i) => {
        if (i !== pi) return p;
        const existing = kind === "graph" || kind === "search" ? p.tabs.find((t) => t.kind === kind) : p.tabs.find((t) => t.path === path);
        if (existing) return { ...p, active: existing.id };
        const tab: Tab = { id: uid("t"), kind, path: kind === "graph" || kind === "search" ? undefined : path, name: pseudoName[kind] ?? baseName(path) };
        return { ...p, tabs: [...p.tabs, tab], active: tab.id, mode: kind === "note" ? "edit" : p.mode };
      });
    });
    if (kind === "note") {
      setRecent(pushRecent(path));
      api
        .readNote(path)
        .then((n: NoteData) =>
          setPanes((prev) =>
            prev.map((p) => ({
              ...p,
              tabs: p.tabs.map((t) =>
                // 只在内容还没被填过时才写回:笔记读盘期间用户可能已经开始打字,
                // 迟到的响应不能把他敲进去的内容冲掉。
                t.path === path && t.content === undefined ? { ...t, content: n.content, meta: n.meta } : t
              ),
            }))
          )
        )
        .catch((e) => console.error("open failed:", e));
    }
  }, [activePane]);

  /** 打开全局搜索视图并可带初始查询(Ctrl+Shift+F / 标签点击)。 */
  const openSearch = useCallback(
    (q = "") => {
      openTab("search://global");
      setSearchSeed((s) => ({ q, n: s.n + 1 }));
    },
    [openTab]
  );

  /** 未解析双链 → 直接创建 <标题>.md 并打开(Obsidian 行为)。 */
  const openUnresolved = useCallback(
    (title: string) => {
      const safe = title.replace(/[\\:*?"<>|]/g, "-").replace(/^\.+/, "").trim() || "未命名";
      const path = `${safe}.md`;
      api.createNote(path, `# ${safe}\n`).then(
        () => {
          refreshTree();
          openTab(path);
        },
        (e) => console.error("create unresolved failed:", e)
      );
    },
    [refreshTree, openTab]
  );

  /** 统一打开入口:路径 / wikilink:<路径或标题> / tag:<标签>。 */
  const openRef = useCallback(
    (ref: string) => {
      if (ref.startsWith("create:")) {
        openUnresolved(ref.slice("create:".length));
        return;
      }
      if (ref.startsWith("tag:")) {
        openSearch(`tag:${ref.slice(4)}`);
        return;
      }
      const jump = (target: string) => openTab(target);
      if (ref.startsWith("wikilink:")) {
        const raw = ref.slice("wikilink:".length);
        const titlePart = raw.split("#")[0];
        // wikilink 可能是已解析路径(含 .md)或标题
        const doTitle = () => {
          api.resolve(titlePart).then((r) => {
            if (r.path) jump(r.path);
            else console.warn("wikilink not found:", titlePart);
          });
        };
        if (titlePart.endsWith(".md")) jump(titlePart);
        else doTitle();
        return;
      }
      if (ref.endsWith(".canvas") || ref.endsWith(".md")) jump(ref);
      else api.resolve(ref).then((r) => r.path && jump(r.path));
    },
    [openTab, openSearch, openUnresolved]
  );

  const createNote = useCallback(async (dir?: string) => {
    const path = `${dir ? `${dir}/` : ""}未命名 ${stamp()}.md`;
    try {
      await api.createNote(path, ""); // 正文留空,笔记名由顶部大标题负责,不再生成重复的「# 未命名」行
    } catch (e) {
      console.error("create note failed:", e);
      return;
    }
    refreshTree();
    openTab(path);
  }, [refreshTree, openTab]);

  const createCanvas = useCallback(async (dir?: string) => {
    const path = `${dir ? `${dir}/` : ""}白板 ${stamp()}.canvas`;
    try {
      await api.createNote(path, initialCanvas);
    } catch (e) {
      console.error("create canvas failed:", e);
      return;
    }
    refreshTree();
    openTab(path);
  }, [refreshTree, openTab]);

  const createDaily = useCallback(async (dir?: string) => {
    const d = new Date();
    const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.md`;
    const path = dir ? `${dir}/${name}` : name;
    try {
      await api.createNote(path, `# ${baseName(path)}\n\n- [ ] \n`);
    } catch {
      /* 已存在直接打开 */
    }
    refreshTree();
    openTab(path);
  }, [refreshTree, openTab]);

  /** 供白板调用:新建笔记/白板文件并返回路径(不抢占当前标签页)。 */
  const createFileForBoard = useCallback(async (kind: "note" | "canvas") => {
    const p = kind === "canvas" ? `白板 ${stamp()}.canvas` : `未命名 ${stamp()}.md`;
    try {
      await api.createNote(p, kind === "canvas" ? initialCanvas : "");
      refreshTree();
      return p;
    } catch (e) {
      console.error("create file failed", e);
      return null;
    }
  }, [refreshTree]);

  /** 供白板调用:今日每日笔记路径(不存在则创建),不抢占标签页。 */
  const dailyForBoard = useCallback(async () => {
    const d = new Date();
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.md`;
    try {
      await api.createNote(p, `# ${baseName(p)}\n\n- [ ] \n`);
    } catch {
      /* 已存在直接引用 */
    }
    refreshTree();
    return p;
  }, [refreshTree]);

  /** 编辑器/白板输入:更新内存缓冲 + 防抖落盘。白板也走这里,保证"删除/重命名前
   *  统一 flush"能覆盖到白板的待存内容(否则迟到的保存会把旧文件写回来)。 */
  const updateContent = useCallback((path: string, content: string) => {
    setPanes((prev) =>
      prev.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.path === path ? { ...t, content } : t)) }))
    );
    window.clearTimeout(saveTimers.current.get(path));
    saveTimers.current.set(
      path,
      window.setTimeout(() => {
        api
          .saveNote(path, content)
          .then(() => setSaveTick((v) => ({ n: v.n + 1, path })))
          .catch(console.error);
      }, 800)
    );
  }, []);

  const flushSave = useCallback(() => {
    for (const [path, timer] of saveTimers.current) {
      window.clearTimeout(timer);
      const pane = panesRef.current.find((p) => p.tabs.some((t) => t.path === path));
      const tab = pane?.tabs.find((t) => t.path === path);
      if (tab?.content !== undefined)
        api
          .saveNote(path, tab.content)
          .then(() => setSaveTick((v) => ({ n: v.n + 1, path })))
          .catch(console.error);
    }
    saveTimers.current.clear();
  }, []);

  /** 立即落盘某文件的待存内容并清掉其防抖定时器(重命名/删除前调用,防旧路径残留/文件复活)。
   *  返回 Promise:重命名/移动前必须 await,否则迟到的保存会把旧路径文件重新写出来。 */
  const flushOne = useCallback(async (path: string, save: boolean) => {
    const timer = saveTimers.current.get(path);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    saveTimers.current.delete(path);
    if (!save) return;
    const pane = panesRef.current.find((p) => p.tabs.some((t) => t.path === path));
    const tab = pane?.tabs.find((t) => t.path === path);
    if (tab?.content !== undefined) await api.saveNote(path, tab.content).catch(console.error);
  }, []);

  // ---------- 标签页操作 ----------
  const closeTab = useCallback(
    (paneId: string, tabId: string) => {
      // 关闭前立即落盘,防 800ms 防抖窗口内关标签丢稿
      const t = panesRef.current.find((p) => p.id === paneId)?.tabs.find((x) => x.id === tabId);
      if (t?.path) flushOne(t.path, true);
      setPanes((prev) =>
        prev
          .map((p) => {
            if (p.id !== paneId) return p;
            const tabs = p.tabs.filter((t) => t.id !== tabId);
            const active = p.active === tabId ? tabs[tabs.length - 1]?.id ?? null : p.active;
            return { ...p, tabs, active };
          })
          .filter((p) => p.tabs.length > 0 || prev.length === 1)
      );
    },
    [flushOne]
  );

  const closePane = useCallback((paneId: string) => {
    setPanes((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== paneId) : prev));
    setActivePane(0);
  }, []);

  const openToSide = useCallback(
    (path: string) => {
      setPanes((prev) => {
        if (prev.length === 1) {
          return [...prev, { id: uid("p"), tabs: [], active: null, mode: "edit" as const }];
        }
        return prev;
      });
      // 等 pane 建好再打开,并把焦点切到新分屏(Obsidian 行为)
      setTimeout(() => {
        openTab(path, { pane: 1 });
        setActivePane(1);
      }, 30);
    },
    [openTab]
  );

  const setMode = useCallback((m: "edit" | "preview") => {
    setPanes((prev) => prev.map((p, i) => (i === activePane ? { ...p, mode: m } : p)));
  }, [activePane]);

  // ---------- 文件管理操作(侧栏回调) ----------
  const renameFile = useCallback(
    async (path: string, newName: string, isDir = false) => {
      await flushOne(path, true); // 先落盘待存修改并等待完成,否则迟到的保存会重建旧路径文件
      const dir = path.split("/").slice(0, -1).join("/");
      // 注意根目录文件:dir 为空时不能拼出 "/名字.md"(前导斜杠会被后端判为越界,导致改名静默失败)
      const newPath = isDir
        ? dir
          ? `${dir}/${newName}`
          : newName
        : `${dir ? `${dir}/` : ""}${newName}.${path.split(".").pop()}`;
      try {
        await api.rename(path, newPath);
      } catch (e) {
        console.error("rename failed:", e);
        return;
      }
      if (!isDir) {
        // 若正文首行是旧名字的「# 标题」(旧版新建笔记自带),改名时一并去掉,避免与大标题重复
        const oldBase = path.split("/").pop()!.replace(/\.\w+$/, "");
        const tab = panesRef.current.find((p) => p.tabs.some((t) => t.path === path))?.tabs.find((t) => t.path === path);
        const c = tab?.content;
        let contentPatch: string | undefined;
        if (typeof c === "string" && c.split("\n")[0]?.trim() === `# ${oldBase}`) {
          contentPatch = c.split("\n").slice(1).join("\n").replace(/^\s*\n/, "");
          api.saveNote(newPath, contentPatch).catch(console.error);
        }
        setPanes((prev) =>
          prev.map((p) => ({
            ...p,
            tabs: p.tabs.map((t) =>
              t.path === path ? { ...t, path: newPath, name: newName, ...(contentPatch !== undefined ? { content: contentPatch } : {}) } : t
            ),
          }))
        );
      } else
        // 文件夹改名:同步已打开标签里的路径前缀
        setPanes((prev) =>
          prev.map((p) => ({
            ...p,
            tabs: p.tabs.map((t) => {
              const tp = t.path ?? "";
              return tp.startsWith(`${path}/`) ? { ...t, path: newPath + tp.slice(path.length) } : t;
            }),
          }))
        );
      moveBookmarks(path, newPath); // 书签路径同步迁移,防悬空
      refreshTree();
    },
    [refreshTree, flushOne]
  );

  const deleteFile = useCallback(
    async (path: string) => {
      flushOne(path, false); // 丢弃待存定时器,防删除后被防抖保存"复活"
      try {
        await api.deleteNote(path);
      } catch (e) {
        console.error("delete failed:", e);
        return;
      }
      removeBookmarks(path); // 同步清理该书签(含文件夹下所有书签),防永久悬空
      setPanes((prev) =>
        prev.map((p) => {
          // 删文件夹时连同其下已打开的标签一起关闭
          const tabs = p.tabs.filter((t) => t.path !== path && !(t.path ?? "").startsWith(`${path}/`));
          return { ...p, tabs, active: tabs.some((t) => t.id === p.active) ? p.active : tabs[tabs.length - 1]?.id ?? null };
        })
      );
      refreshTree();
    },
    [refreshTree]
  );

  /** 拖拽移动:改路径(不更新双链,标题未变)并同步已开标签。 */
  const moveFile = useCallback(
    async (src: string, dst: string) => {
      if (dst === src || dst.startsWith(`${src}/`)) return; // 不能移进自身/子目录
      await flushOne(src, true); // 移动前先落盘并等待完成,防旧路径文件被迟到的保存重建
      try {
        await api.rename(src, dst, false);
      } catch (e) {
        console.error("move failed:", e);
        return;
      }
      setPanes((prev) =>
        prev.map((p) => ({
          ...p,
          tabs: p.tabs.map((t) => {
            const tp = t.path ?? "";
            if (tp === src) return { ...t, path: dst, name: baseName(dst) };
            if (tp.startsWith(`${src}/`)) return { ...t, path: dst + tp.slice(src.length) };
            return t;
          }),
        }))
      );
      refreshTree();
    },
    [refreshTree, flushOne]
  );

  // ---------- 全局快捷键 ----------
  const commands: Command[] = [
    { id: "new-note", label: "新建笔记", hint: "Ctrl+N" },
    { id: "new-canvas", label: "新建白板", hint: "Ctrl+Shift+N" },
    { id: "daily", label: "打开/创建每日笔记", hint: "Ctrl+D" },
    { id: "graph", label: "打开关系图谱", hint: "Ctrl+G" },
    { id: "search", label: "全局搜索", hint: "Ctrl+Shift+F" },
    { id: "quick-switch", label: "快速切换文件", hint: "Ctrl+O" },
    { id: "split", label: "左右分屏", hint: "" },
    { id: "toggle-mode", label: "切换 编辑/阅读", hint: "Ctrl+E" },
    { id: "toggle-sidebar", label: "显示/隐藏侧栏", hint: "Ctrl+B" },
    { id: "settings", label: "打开设置", hint: "Ctrl+," },
    { id: "new-folder", label: "新建文件夹", hint: "Ctrl+Shift+O" },
  ];

  const runCommand = useCallback(
    (id: string) => {
      setPaletteOpen(false);
      if (id === "new-note") createNote();
      if (id === "new-canvas") createCanvas();
      if (id === "daily") createDaily();
      if (id === "graph") openTab("graph://global");
      if (id === "search") openSearch();
      if (id === "quick-switch") setPaletteOpen(true);
      if (id === "toggle-mode") setMode(panes[activePane]?.mode === "edit" ? "preview" : "edit");
      if (id === "toggle-sidebar") {
        setSidebarOpen((v) => {
          localStorage.setItem("mindbox-sidebar", v ? "0" : "1");
          return !v;
        });
      }
      if (id === "settings") setSettingsOpen(true);
      if (id === "split" && activeTab?.path) openToSide(activeTab.path);
      if (id === "new-folder") {
        const dir = activeTab?.path?.split("/").slice(0, -1).join("/") || "";
        api.createFolder(`${dir ? `${dir}/` : ""}新文件夹 ${Date.now() % 1000}`).then(refreshTree);
      }
    },
    [createNote, createCanvas, createDaily, openTab, openSearch, setMode, panes, activePane, activeTab, openToSide, refreshTree]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (k === "n") {
        e.preventDefault();
        if (e.shiftKey) createCanvas();
        else createNote();
      } else if (k === "d") {
        e.preventDefault();
        createDaily();
      } else if (k === "o" && e.shiftKey) {
        e.preventDefault();
        runCommand("new-folder");
      } else if (k === "g") {
        e.preventDefault();
        openTab("graph://global");
      } else if (k === "f" && e.shiftKey) {
        e.preventDefault();
        openSearch();
      } else if (k === "o") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (k === "e") {
        e.preventDefault();
        setMode(panes[activePane]?.mode === "edit" ? "preview" : "edit");
      } else if (k === "b") {
        e.preventDefault();
        setSidebarOpen((v) => {
          localStorage.setItem("mindbox-sidebar", v ? "0" : "1");
          return !v;
        });
      } else if (k === "s") {
        e.preventDefault();
        flushSave();
      } else if (k === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (k === "w") {
        e.preventDefault();
        const p = panes[activePane];
        if (p?.active) closeTab(p.id, p.active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNote, createCanvas, createDaily, runCommand, openTab, openSearch, setMode, panes, activePane, flushSave, closeTab]);

  /** 标签拖放:同 pane 重排 / 跨 pane 移动。beforeTabId=null 表示追加到末尾。 */
  const dropTabOnBar = useCallback((targetPaneId: string, beforeTabId: string | null) => {
    const d = dragTab.current;
    dragTab.current = null;
    if (!d) return;
    setPanes((prev) => {
      const from = prev.find((p) => p.id === d.paneId);
      const moving = from?.tabs.find((t) => t.id === d.tabId);
      if (!from || !moving) return prev;
      const next = prev.map((p) => {
        if (p.id === d.paneId && p.id === targetPaneId) {
          const without = p.tabs.filter((t) => t.id !== d.tabId);
          const idx = beforeTabId ? Math.max(0, without.findIndex((t) => t.id === beforeTabId)) : without.length;
          return { ...p, tabs: [...without.slice(0, idx), moving, ...without.slice(idx)] };
        }
        if (p.id === d.paneId) {
          const tabs = p.tabs.filter((t) => t.id !== d.tabId);
          return { ...p, tabs, active: p.active === d.tabId ? tabs[tabs.length - 1]?.id ?? null : p.active };
        }
        if (p.id === targetPaneId) {
          const idx = beforeTabId ? Math.max(0, p.tabs.findIndex((t) => t.id === beforeTabId)) : p.tabs.length;
          return { ...p, tabs: [...p.tabs.slice(0, idx), moving, ...p.tabs.slice(idx)], active: moving.id };
        }
        return p;
      });
      return next.filter((p) => p.tabs.length > 0 || next.length === 1);
    });
  }, []);

  /** 大纲点击:编辑模式用编辑器注册表跳行;预览模式滚动 DOM 锚点。 */
  const jumpHeading = useCallback(
    (h: Heading) => {
      const p = activeTab?.kind === "note" ? activeTab.path : undefined;
      if (!p) return;
      if (panes[activePane]?.mode === "edit") {
        const view = editorRegistry.get(p);
        if (view) {
          const doc = view.state.doc;
          const info = doc.line(Math.min(h.line + 1, doc.lines));
          view.dispatch({ selection: { anchor: info.from }, scrollIntoView: true });
          view.focus();
          return;
        }
      }
      const id = `h-${encodeURIComponent(h.text.trim().replace(/\s+/g, "-"))}`;
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [activeTab, panes, activePane]
  );

  const renderTabBody = (pane: Pane, tab: Tab) => {
    if (tab.kind === "graph")
      return (
        <GraphView
          focusPath={activeTab?.path?.endsWith(".md") ? activeTab.path : undefined}
          onOpen={(p) => openTab(p)}
          onClose={() => closeTab(pane.id, tab.id)}
          revision={vaultRev}
          saveTick={saveTick.n}
        />
      );
    if (tab.kind === "search") return <SearchView seed={searchSeed} onOpen={(p) => openTab(p)} />;
    if (tab.kind === "canvas")
      return (
        <CanvasBoard
          path={tab.path!}
          name={tab.name}
          vault={tree}
          onOpen={(p) => openTab(p)}
          onBack={() => closeTab(pane.id, tab.id)}
          onCreateFile={createFileForBoard}
          onCreateDaily={dailyForBoard}
          onSave={(c) => updateContent(tab.path!, c)}
          onSaveNow={flushSave}
          saveTick={saveTick}
        />
      );
    return (
      <NoteView
        note={{ path: tab.path!, name: tab.name, content: tab.content ?? "", meta: tab.meta ?? {} }}
        mode={pane.mode}
        onMode={setMode}
        onChange={(c) => updateContent(tab.path!, c)}
        onOpen={openRef}
        onOpenUnresolved={openUnresolved}
        onSaveNow={flushSave}
        onRename={renameFile}
        key={tab.id}
      />
    );
  };

  return (
    <div className={`app ${sidebarOpen ? "" : "no-sidebar"} ${panelOpen ? "" : "no-panel"}`}>
      {sidebarOpen && (
        <Sidebar
          tree={tree}
          activePath={activeTab?.path}
          viewKind={activeTab?.kind}
          onOpen={openRef}
          onOpenFiles={() => {
            // 优先最近打开;否则取树中第一条笔记,保证「文件」始终有响应
            if (recent[0]) {
              openTab(recent[0]);
              return;
            }
            const first = (function pick(nodes: TreeNode[]): string | undefined {
              for (const n of nodes) {
                if (n.type !== "dir") return n.path;
                const c = n.children ? pick(n.children) : undefined;
                if (c) return c;
              }
            })(tree);
            if (first) openTab(first);
          }}
          onOpenGraph={() => openTab("graph://global")}
          onOpenSearch={() => openSearch()}
          onCreate={() => createNote()}
          onCreateCanvas={() => createCanvas()}
          onCreateIn={(dir) => createNote(dir || undefined)}
          onCreateCanvasIn={(dir) => createCanvas(dir || undefined)}
          onCreateDailyIn={(dir) => createDaily(dir || undefined)}
          searchQuery={sidebarSearch}
          onSearchChange={setSidebarSearch}
          onRename={renameFile}
          onDelete={deleteFile}
          onMove={moveFile}
          onRefresh={refreshTree}
          onOpenToSide={openToSide}
        />
      )}
      <div className="panes" onMouseDown={(e) => {
        // 点击分屏区切换活动分屏
        const el = (e.target as HTMLElement).closest(".pane");
        if (el) {
          const idx = Array.from((el.parentElement as HTMLElement).children).indexOf(el);
          if (idx >= 0) setActivePane(idx);
        }
      }}>
        {panes.map((pane, pi) => (
          <section key={pane.id} className={`pane ${pi === activePane && panes.length > 1 ? "pane-active" : ""}`}>
            <div
              className="tabbar"
              onDragOver={(e) => dragTab.current && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                dropTabOnBar(pane.id, null);
              }}
            >
              {pane.tabs.map((t) => (
                <div
                  key={t.id}
                  className={`tab ${t.kind === "graph" ? "tab-graph" : t.kind === "canvas" ? "tab-canvas" : t.kind === "search" ? "tab-search" : ""} ${pane.active === t.id ? "active" : ""}`}
                  draggable
                  onDragStart={(e) => {
                    dragTab.current = { paneId: pane.id, tabId: t.id };
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => dragTab.current && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropTabOnBar(pane.id, t.id);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setActivePane(pi);
                    setPanes((prev) => prev.map((p) => (p.id === pane.id ? { ...p, active: t.id } : p)));
                  }}
                  onAuxClick={(e) => e.button === 1 && closeTab(pane.id, t.id)}
                  title={t.path ?? t.name}
                >
                  <span className="tab-name">{t.name}</span>
                  <span
                    className="tab-close"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      closeTab(pane.id, t.id);
                    }}
                  >
                    ×
                  </span>
                </div>
              ))}
              {panes.length > 1 && (
                <span className="pane-close" title="关闭分屏" onMouseDown={(e) => { e.stopPropagation(); closePane(pane.id); }}>
                  ⤡
                </span>
              )}
            </div>
            <div className="pane-body">
              {pane.active ? (
                renderTabBody(pane, pane.tabs.find((t) => t.id === pane.active)!)
              ) : (
                <div className="welcome">
                  <h1>Mindbox</h1>
                  <p>本地优先的笔记软件</p>
                  <p className="hint">Ctrl+O 快速切换 · Ctrl+N 新建笔记 · Ctrl+B 侧栏 · 双击文字即可编辑</p>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
      {panelOpen && (
        <RightPanel
          saveTick={saveTick}
          activeNote={
            activeTab?.kind === "note" ? { path: activeTab.path!, meta: activeTab.meta ?? {}, content: activeTab.content ?? "" } : null
          }
          onOpen={openRef}
          onJumpHeading={jumpHeading}
          onCollapse={() => setPanelOpen(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          tree={tree}
          commands={commands}
          onPick={(path) => {
            openRef(path);
            setPaletteOpen(false);
          }}
          onCommand={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onImported={refreshTree}
          onRestored={(p: string) => {
            // 恢复快照后刷新所有已打开的该笔记标签(编辑器 value 变化会整体替换文档)
            api
              .readNote(p)
              .then((n: NoteData) =>
                setPanes((prev) =>
                  prev.map((pane) => ({
                    ...pane,
                    tabs: pane.tabs.map((t) => (t.path === p ? { ...t, content: n.content, meta: n.meta } : t)),
                  }))
                )
              )
              .catch(console.error);
          }}
        />
      )}
      <StatusBar
        activeTab={activeTab}
        saveTick={saveTick}
        panelOpen={panelOpen}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => {
          setSidebarOpen((v) => {
            localStorage.setItem("mindbox-sidebar", v ? "0" : "1");
            return !v;
          });
        }}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </div>
  );
}
