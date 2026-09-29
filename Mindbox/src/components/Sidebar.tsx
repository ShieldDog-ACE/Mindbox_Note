import { useEffect, useMemo, useRef, useState } from "react";
import { api, SearchResult, TreeNode } from "../lib/api";
import { loadBookmarks, toggleBookmark } from "../lib/store";
import { IconBoard, IconFiles, IconGraph, IconPlus, IconSearch } from "./icons";

interface Props {
  tree: TreeNode[];
  activePath?: string;
  viewKind?: "note" | "canvas" | "graph" | "search"; // 当前活动视图(主导航高亮)
  onOpen: (path: string) => void;
  onOpenFiles: () => void; // 主导航「文件」:打开最近笔记
  onOpenGraph: () => void;
  onOpenSearch: () => void;
  onOpenToSide: (path: string) => void;
  onCreate: () => void;
  onCreateCanvas: () => void;
  onCreateIn: (dir: string) => void; // 在指定目录新建笔记(dir 为 "" 表示根目录)
  onCreateCanvasIn: (dir: string) => void;
  onCreateDailyIn: (dir: string) => void;
  onRename: (path: string, newName: string, isDir?: boolean) => void;
  onDelete: (path: string) => void;
  onMove: (src: string, dst: string) => void | Promise<void>;
  onRefresh: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

interface MenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
  dir: string; // 新建目标目录("" = 根目录)
}

/** 内置记忆文件夹:不可删除/重命名/剪切,树中高亮显示。 */
export const MEMORY_FOLDERS = ["短期记忆", "长期记忆", "永久记忆"];
const isProtectedDir = (node: TreeNode) => node.type === "dir" && !node.path.includes("/") && MEMORY_FOLDERS.includes(node.name);
const isDirProtectedPath = (path: string) => !!path && !path.includes("/") && MEMORY_FOLDERS.includes(path);

/** 递归目录树:目录可折叠,文件支持右键菜单与拖拽移动。 */
function TreeItem({
  node,
  depth,
  activePath,
  selectedPath,
  onOpen,
  onOpenToSide,
  onMenu,
  onDropOn,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activePath?: string;
  selectedPath?: string;
  onOpen: (p: string) => void;
  onOpenToSide: (p: string) => void;
  onMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onDropOn: (srcPath: string, dstDir: string) => void;
  onSelect: (path: string, isDir: boolean) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const [dropping, setDropping] = useState(false);

  if (node.type === "dir") {
    return (
      <div>
        <div
          className={`tree-dir ${isProtectedDir(node) ? "protected" : ""} ${selectedPath === node.path ? "selected" : ""}`}
          style={{ paddingLeft: depth * 14 }}
          onClick={() => {
            setOpen(!open);
            onSelect(node.path, true);
          }}
          onContextMenu={(e) => onMenu(e, node)}
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const src = e.dataTransfer.getData("text/mindbox-path");
            if (src) onDropOn(src, node.path);
          }}
          draggable
          onDragStart={(e) => {
            // 供白板接收:路径 + 类型(文件夹拖入白板会变成分组卡)
            e.dataTransfer.setData("text/mindbox-path", node.path);
            e.dataTransfer.setData("text/mindbox-kind", "dir");
            e.dataTransfer.effectAllowed = "copyMove";
          }}
        >
          <span className={`caret ${open ? "open" : ""}`} />
          {node.name}
        </div>
        {open &&
          node.children?.map((c) => (
            <TreeItem
              key={c.path}
              node={c}
              depth={depth + 1}
              activePath={activePath}
              selectedPath={selectedPath}
              onOpen={onOpen}
              onOpenToSide={onOpenToSide}
              onMenu={onMenu}
              onDropOn={onDropOn}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }
  return (
    <div
      className={`tree-note ${node.type === "canvas" ? "tree-canvas" : ""} ${activePath === node.path ? "active" : ""} ${selectedPath === node.path ? "selected" : ""} ${dropping ? "dropping" : ""}`}
      style={{ paddingLeft: depth * 14 + 14 }}
      onClick={(e) => {
        onSelect(node.path, false);
        e.ctrlKey || e.metaKey ? onOpenToSide(node.path) : onOpen(node.path);
      }}
      onContextMenu={(e) => onMenu(e, node)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/mindbox-path", node.path);
        e.dataTransfer.setData("text/mindbox-kind", node.type === "canvas" ? "canvas" : "note");
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      onDragOver={(e) => e.preventDefault()}
    >
      {node.name}
    </div>
  );
}

/** 左侧文件管理器:主导航横排 + 搜索 + 树 + 右键操作。 */
export default function Sidebar({
  tree,
  activePath,
  viewKind,
  onOpen,
  onOpenFiles,
  onOpenGraph,
  onOpenSearch,
  onOpenToSide,
  onCreate,
  onCreateCanvas,
  onCreateIn,
  onCreateCanvasIn,
  onCreateDailyIn,
  onRename,
  onDelete,
  onMove,
  onRefresh,
  searchQuery,
  onSearchChange,
}: Props) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; value: string; isDir?: boolean } | null>(null);
  const [clip, setClip] = useState<{ mode: "copy" | "cut"; path: string; isDir?: boolean } | null>(null); // 文件剪贴板
  const [bookmarks, setBookmarks] = useState<string[]>(loadBookmarks);
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null); // 文件树选中项(键盘快捷键作用对象)
  const [pinned, setPinned] = useState<{ bm: boolean }>({ bm: false });
  const debounce = useRef<number>();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults(null);
      return;
    }
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(async () => {
      try {
        setResults(await api.search(searchQuery));
      } catch {
        setResults([]);
      }
    }, 300);
    return () => window.clearTimeout(debounce.current);
  }, [searchQuery]);

  // 点击别处关闭右键菜单
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  // 删除/重命名文件后书签在 store 层同步清理,这里监听刷新显示
  useEffect(() => {
    const sync = () => setBookmarks(loadBookmarks());
    window.addEventListener("mindbox-bookmarks-changed", sync);
    return () => window.removeEventListener("mindbox-bookmarks-changed", sync);
  }, []);

  // 书签指向的文件已被删除(历史遗留)则不再显示
  const pathSet = useMemo(() => {
    const s = new Set<string>();
    const walk = (ns: TreeNode[]) =>
      ns.forEach((n) => {
        s.add(n.path);
        if (n.children) walk(n.children);
      });
    walk(tree);
    return s;
  }, [tree]);
  const validBookmarks = bookmarks.filter((p) => pathSet.has(p));

  // 文件树键盘快捷键(树获得焦点 + 有选中项时生效,不影响编辑器内的同名按键)
  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (!selected) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const pasteDir = selected.isDir ? selected.path : selected.path.split("/").slice(0, -1).join("/");
    if (mod && k === "c") {
      e.preventDefault();
      setClip({ mode: "copy", path: selected.path, isDir: selected.isDir });
    } else if (mod && k === "x") {
      e.preventDefault();
      setClip({ mode: "cut", path: selected.path, isDir: selected.isDir });
    } else if (mod && k === "v") {
      e.preventDefault();
      if (clip) pasteInto(pasteDir);
    } else if (mod && e.shiftKey && k === "b") {
      e.preventDefault();
      setBookmarks(toggleBookmark(selected.path));
    } else if (e.key === "F2") {
      e.preventDefault();
      setRenaming({
        path: selected.path,
        value: selected.isDir ? selected.path.split("/").pop()! : selected.path.split("/").pop()!.replace(/\.\w+$/, ""),
        isDir: selected.isDir,
      });
    } else if (e.key === "Delete") {
      e.preventDefault();
      const kind = selected.isDir ? `文件夹 ${selected.path} 及其全部内容` : selected.path;
      if (confirm(`删除 ${kind}?(进入 .trash 可恢复)`)) onDelete(selected.path);
    }
  };

  const moveFile = (src: string, dstDir: string) => {
    const dir = src.split("/").slice(0, -1).join("/");
    if (dir === dstDir) return;
    const name = src.split("/").pop()!;
    onMove(src, dstDir ? `${dstDir}/${name}` : name); // 根目录不能拼 "/" 前缀,否则后端判越界
  };

  const onMenuDirect = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected({ path, isDir: false });
    setMenu({ x: e.clientX, y: e.clientY, path, isDir: false, dir: path.split("/").slice(0, -1).join("/") });
  };

  const onMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    const isDir = node.type === "dir";
    setSelected({ path: node.path, isDir });
    setMenu({
      x: e.clientX,
      y: e.clientY,
      path: node.path,
      isDir,
      dir: isDir ? node.path : node.path.split("/").slice(0, -1).join("/"),
    });
  };

  // 顶层内置记忆文件夹(短期/长期/永久记忆):不可删除/重命名/剪切
  const menuProtected = isDirProtectedPath(menu?.path ?? "");

  // 文件区空白处右键:根目录创建菜单
  const onTreeMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path: "", isDir: true, dir: "" });
  };

  /** 粘贴:剪切 = 移动(同名不变),复制 = 另存为「xx 副本 n」(文件夹递归复制)。 */
  const pasteInto = async (dir: string) => {
    if (!clip) return;
    const name = clip.path.split("/").pop()!;
    const target = dir ? `${dir}/${name}` : name;
    // 防呆:不能把文件夹移动/复制进它自己或其子目录
    if (dir === clip.path || dir.startsWith(`${clip.path}/`)) return;
    if (clip.mode === "cut") {
      if (clip.path !== target) {
        try {
          await onMove(clip.path, target);
        } catch (e) {
          console.error("move failed:", e);
        }
      }
      setClip(null); // 剪切粘贴一次性
    } else {
      try {
        if (clip.isDir) {
          // 文件夹:取一个未占用的「副本 n」名字后递归复制
          const exists = (p: string): boolean => {
            const walk = (ns: TreeNode[]): boolean => ns.some((n) => n.path === p || (n.children ? walk(n.children) : false));
            return walk(tree);
          };
          let n = 1;
          let dst = `${dir ? `${dir}/` : ""}${name}`;
          while (exists(dst)) dst = `${dir ? `${dir}/` : ""}${name} 副本 ${n++}`;
          await api.copyItem(clip.path, dst);
        } else {
          const note = await api.readNote(clip.path);
          const m = name.match(/^(.*?)(\.\w+)?$/)!;
          await api.createNote(`${dir ? `${dir}/` : ""}${m[1]} 副本 ${Date.now() % 10000}${m[2] ?? ""}`, note.content);
        }
      } catch (e) {
        console.error("paste failed:", e);
      }
    }
    onRefresh();
  };

  return (
    <aside className="sidebar">
      <div className="side-nav">
        <button className={`nav-btn ${viewKind === "note" || viewKind === "canvas" ? "active" : ""}`} onClick={onOpenFiles} title="文件">
          <IconFiles />
        </button>
        <button className={`nav-btn ${viewKind === "graph" ? "active" : ""}`} onClick={onOpenGraph} title="关系图谱 (Ctrl+G)">
          <IconGraph />
        </button>
        <button className={`nav-btn ${viewKind === "search" ? "active" : ""}`} onClick={onOpenSearch} title="全局搜索 (Ctrl+Shift+F)">
          <IconSearch />
        </button>
        <span className="nav-gap" />
        <button className="nav-btn" onClick={onCreate} title="新建笔记 (Ctrl+N)">
          <IconPlus />
        </button>
        <button className="nav-btn" onClick={onCreateCanvas} title="新建白板 (Ctrl+Shift+N)">
          <IconBoard />
        </button>
      </div>
      <input
        className="side-search"
        placeholder="搜索…(分词容错)"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {validBookmarks.length > 0 && (
        <div className="side-section">
          <div className="side-section-head" onClick={() => setPinned((p) => ({ ...p, bm: !p.bm }))}>
            <span className={`caret ${pinned.bm ? "open" : ""}`} /> 书签 · {validBookmarks.length}
          </div>
          {pinned.bm &&
            validBookmarks.map((p) => (
              <div key={p} className={`tree-note ${activePath === p ? "active" : ""}`} onClick={() => onOpen(p)}>
                {p.split("/").pop()}
              </div>
            ))}
        </div>
      )}
      {results ? (
        <div className="tree" onContextMenu={onTreeMenu}>
          {results.map((r) => (
            <div key={r.path} className="tree-note" onClick={() => onOpen(r.path)} onContextMenu={(e) => onMenuDirect(e, r.path)}>
              <div className="hit-name">{r.name}</div>
              <div className="hit-snippet">{r.snippets[0]?.text ?? ""}</div>
            </div>
          ))}
          {results.length === 0 && <div className="empty-hint">无结果</div>}
        </div>
      ) : (
        <div className="tree" onContextMenu={onTreeMenu} tabIndex={0} onKeyDown={onTreeKeyDown}>
          {tree.map((n) => (
            <TreeItem
              key={n.path}
              node={n}
              depth={0}
              activePath={activePath}
              selectedPath={selected?.path}
              onOpen={onOpen}
              onOpenToSide={onOpenToSide}
              onMenu={onMenu}
              onDropOn={moveFile}
              onSelect={(path, isDir) => setSelected({ path, isDir })}
            />
          ))}
        </div>
      )}

      {menu && (
        <div ref={menuRef} className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          {menu.isDir ? (
            <>
              <div className="ctx-item" onClick={() => { setMenu(null); onCreateIn(menu.dir); }}>
                新建笔记<span className="ctx-key">Ctrl+N</span>
              </div>
              <div className="ctx-item" onClick={() => { setMenu(null); onCreateCanvasIn(menu.dir); }}>
                新建白板<span className="ctx-key">Ctrl+Shift+N</span>
              </div>
              <div className="ctx-item" onClick={() => { setMenu(null); onCreateDailyIn(menu.dir); }}>
                新建每日笔记<span className="ctx-key">Ctrl+D</span>
              </div>
              <div className="ctx-item" onClick={() => { setMenu(null); api.createFolder(`${menu.dir ? `${menu.dir}/` : ""}新文件夹 ${Date.now() % 1000}`).then(onRefresh); }}>
                新建文件夹<span className="ctx-key">Ctrl+Shift+O</span>
              </div>
              {menu.path && !menuProtected && (
                <>
                  <div className="ctx-sep" />
                  <div className="ctx-item" onClick={() => { setClip({ mode: "cut", path: menu.path, isDir: true }); setMenu(null); }}>
                    剪切<span className="ctx-key">Ctrl+X</span>
                  </div>
                  <div className="ctx-item" onClick={() => { setClip({ mode: "copy", path: menu.path, isDir: true }); setMenu(null); }}>
                    复制<span className="ctx-key">Ctrl+C</span>
                  </div>
                  {clip && (
                    <div className="ctx-item" onClick={() => { setMenu(null); pasteInto(menu.path); }}>
                      粘贴<span className="ctx-key">Ctrl+V</span>
                    </div>
                  )}
                  <div className="ctx-sep" />
                  <div className="ctx-item" onClick={() => { setRenaming({ path: menu.path, value: menu.path.split("/").pop()!, isDir: true }); setMenu(null); }}>
                    重命名<span className="ctx-key">F2</span>
                  </div>
                  <div className="ctx-item danger" onClick={() => { if (confirm(`删除文件夹 ${menu.path} 及其全部内容?(进入 .trash 可恢复)`)) onDelete(menu.path); setMenu(null); }}>
                    删除<span className="ctx-key">Delete</span>
                  </div>
                </>
              )}
              {clip && !menu.path && (
                <>
                  <div className="ctx-sep" />
                  <div className="ctx-item" onClick={() => { setMenu(null); pasteInto(menu.dir); }}>
                    粘贴{clip.mode === "cut" ? "(移动)" : ""}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="ctx-item" onClick={() => { setClip({ mode: "cut", path: menu.path }); setMenu(null); }}>
                剪切<span className="ctx-key">Ctrl+X</span>
              </div>
              <div className="ctx-item" onClick={() => { setClip({ mode: "copy", path: menu.path }); setMenu(null); }}>
                复制<span className="ctx-key">Ctrl+C</span>
              </div>
              {clip && (
                <div className="ctx-item" onClick={() => { setMenu(null); pasteInto(menu.dir); }}>
                  粘贴<span className="ctx-key">Ctrl+V</span>
                </div>
              )}
              <div className="ctx-sep" />
              <div
                className="ctx-item"
                onClick={() => {
                  setBookmarks(toggleBookmark(menu.path));
                  setMenu(null);
                }}
              >
                {bookmarks.includes(menu.path) ? "移除书签" : "添加书签"}
                <span className="ctx-key">Ctrl+Shift+B</span>
              </div>
              <div className="ctx-item" onClick={() => { setRenaming({ path: menu.path, value: menu.path.split("/").pop()!.replace(/\.\w+$/, "") }); setMenu(null); }}>
                重命名<span className="ctx-key">F2</span>
              </div>
              <div className="ctx-item" onClick={() => { onOpenToSide(menu.path); setMenu(null); }}>
                在右侧分屏打开
              </div>
              <div className="ctx-item danger" onClick={() => { if (confirm(`删除 ${menu.path}?(进入 .trash 可恢复)`)) onDelete(menu.path); setMenu(null); }}>
                删除<span className="ctx-key">Delete</span>
              </div>
            </>
          )}
        </div>
      )}

      {renaming && (
        <div className="palette-mask" onClick={() => setRenaming(null)}>
          <div className="rename-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="settings-head">重命名(双链将同步更新)</div>
            <input
              autoFocus
              value={renaming.value}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renaming.value.trim()) {
                  e.stopPropagation();
                  onRename(renaming.path, renaming.value.trim(), !!renaming.isDir);
                  setRenaming(null);
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setRenaming(null);
                }
              }}
            />
            <button
              className="btn primary"
              onClick={() => {
                if (renaming.value.trim()) onRename(renaming.path, renaming.value.trim(), !!renaming.isDir);
                setRenaming(null);
              }}
            >
              确定
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
