/**
 * 白板 v3 —— 严格遵循 JSON Canvas 1.0 规范(jsoncanvas.org)。
 * 节点:text / file(笔记引用) / link / group;边:fromNode/toNode + 侧别 + 标签 + 颜色。
 * 交互:双击空白建卡 · 拖动 · 卡角拖拽缩放 · 连接柄连线 · Delete 删除 · 右键卡片换色。
 * 性能:拖拽/缩放/平移/连线手势直接写 DOM(与图谱 v3 同架构),松手才提交一次状态+防抖保存;
 *       手势监听挂 window,拖出白板边界不丢手势。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SaveTick } from "../App";
import { api, TreeNode } from "../lib/api";
import { IconLink } from "./icons";

interface Props {
  path: string;
  name: string;
  vault: TreeNode[]; // 完整文件树:引用面板列出 笔记/白板/文件夹,并支持拖入
  onOpen: (path: string) => void;
  onBack: () => void;
  onCreateFile: (kind: "note" | "canvas") => Promise<string | null>; // 从白板新建文件并返回路径
  onCreateDaily: () => Promise<string | null>; // 今天/创建并返回每日笔记路径
  /** 内容变更 → 交给 App 的统一保存管线(防抖 + 可被 flushOne 取消)。
   *  白板早期自建了一套 700ms 防抖保存,App 删除/重命名文件时清不掉它,
   *  迟到的保存会把旧路径文件重新写出来(幽灵文件)。 */
  onSave: (content: string) => void;
  /** Ctrl+S:立即落盘(App 统一 flush) */
  onSaveNow?: () => void;
  /** 保存信号:path 命中时把状态置为"已保存" */
  saveTick?: SaveTick;
}

/** JSON Canvas 1.0 类型(节选自官方 spec)。 */
interface JCNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}

interface JCEdge {
  id: string;
  fromNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toNode: string;
  toSide?: "top" | "right" | "bottom" | "left";
  color?: string;
  label?: string;
}

interface JCData {
  nodes: JCNode[];
  edges: JCEdge[];
}

const EMPTY: JCData = { nodes: [], edges: [] };
const PRESET = ["1", "2", "3", "4", "5", "6"];
const PRESET_HEX: Record<string, string> = {
  "1": "#fb464c", "2": "#e78342", "3": "#eac45f", "4": "#44cf6e", "5": "#53b7dd", "6": "#b45de0",
};
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** 拍平文件树(引用面板与拖入都用它)。 */
function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const SIDE_CENTER: Record<Side, (n: JCNode) => [number, number]> = {
  top: (n) => [n.x + n.width / 2, n.y],
  right: (n) => [n.x + n.width, n.y + n.height / 2],
  bottom: (n) => [n.x + n.width / 2, n.y + n.height],
  left: (n) => [n.x, n.y + n.height / 2],
};

export default function CanvasBoard({ path, name, vault, onOpen, onBack, onCreateFile, onCreateDaily, onSave, onSaveNow, saveTick }: Props) {
  const [data, setData] = useState<JCData>(EMPTY);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving">("saved");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  // 空白处右键菜单(建卡/建文件/引用)
  const [boardCtx, setBoardCtx] = useState<{ x: number; y: number; bx: number; by: number } | null>(null);
  // 引用面板:kind=all 时列出全部分组(笔记/白板/文件夹)
  const [pick, setPick] = useState<{ x: number; y: number; at: { x: number; y: number } | null; kind: "all" | "note" | "canvas" | "dir" } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);
  const pickRef = useRef<HTMLDivElement>(null);
  const pickPanelRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ x: 40, y: 40, k: 1 });
  const dataRef = useRef<JCData>(EMPTY); // 手势帧内读写的数据镜像(与 data 状态同步)
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const linkRef = useRef<{ from: string; fromSide: Side; sx: number; sy: number } | null>(null);
  const loadedRef = useRef("");
  const boardRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null); // .board-canvas,平移/缩放直写 transform
  const tempLineRef = useRef<SVGLineElement>(null); // 连线中的临时线
  const cardElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const edgeElsRef = useRef<Map<string, SVGPathElement>>(new Map());

  useEffect(() => {
    if (loadedRef.current === path) return;
    loadedRef.current = path;
    api
      .readNote(path)
      .then((n) => {
        let d = EMPTY;
        try {
          d = { ...EMPTY, ...(JSON.parse(n.content) as JCData) };
        } catch {
          /* 坏文件按空白板处理 */
        }
        dataRef.current = d;
        setData(d);
        setStatus("saved");
      })
      .catch(() => {
        dataRef.current = EMPTY;
        setData(EMPTY);
      });
  }, [path]);

  /** 结构性变更(建卡/删卡/连线/改文本/颜色):走 React,保存交给 App 的统一流水线
   *  (防抖 800ms + 可被 flushOne 取消),不再自建定时器。 */
  const mutate = useCallback(
    (fn: (d: JCData) => JCData) => {
      setData((prev) => {
        const next = fn(prev);
        dataRef.current = next; // 手势帧直接读镜像,不必等 React 渲染
        onSave(JSON.stringify(next, null, 2));
        return next;
      });
      setStatus("dirty");
    },
    [onSave]
  );

  // 落盘成功(App 统一保存后广播 saveTick,带 path)→ 状态回到"已保存"
  useEffect(() => {
    if (saveTick && saveTick.n > 0 && saveTick.path === path) setStatus("saved");
  }, [saveTick, path]);

  /** 手势提交(拖拽/缩放松手):一次性写入最终几何,单次渲染+保存。 */
  const commitGesture = useCallback(() => {
    const dg = dragRef.current;
    const rz = resizeRef.current;
    if (!dg && !rz) return;
    const snapshot = dataRef.current;
    mutate((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        if (dg && n.id === dg.id) {
          const s = snapshot.nodes.find((x) => x.id === dg.id);
          return s ? { ...n, x: s.x, y: s.y } : n;
        }
        if (rz && n.id === rz.id) {
          const s = snapshot.nodes.find((x) => x.id === rz.id);
          return s ? { ...n, width: s.width, height: s.height } : n;
        }
        return n;
      }),
    }));
  }, [mutate]);

  // 全局键盘:Ctrl+S 立即保存;Delete/Escape 仅当焦点在白板内才生效
  // (否则在另一分屏的笔记编辑器里打字会误删白板选中卡片)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setStatus("saving");
        onSaveNow?.(); // 落盘由 App 统一 flush;成功后经 saveTick 回到"已保存"
        return;
      }
      const tgt = e.target as HTMLElement | null;
      const inBoard = !!tgt?.closest?.(".board") || tgt === document.body;
      if (!inBoard || tgt?.closest?.("input, textarea")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected && editing !== selected) {
        e.preventDefault();
        // selected 既可能是卡片 id 也可能是连线 id:
        //   卡片 → 连同挂在它上面的连线一起删
        //   连线 → 只删这一条(旧实现只过滤 nodes,导致选中连线后按 Delete 毫无反应)
        mutate((d) => ({
          nodes: d.nodes.filter((n) => n.id !== selected),
          edges: d.edges.filter((e2) => e2.id !== selected && e2.fromNode !== selected && e2.toNode !== selected),
        }));
        setSelected(null);
      }
      if (e.key === "Escape" && !editing) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, editing, mutate, onSaveNow, onBack]);

  // 点击别处关闭右键 / 引用面板(面板自身 stopPropagation,条目点击不受影响)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pickPanelRef.current?.contains(t) && !pickRef.current?.contains(t)) setPick(null);
      setCtx(null);
      setBoardCtx(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const clientToBoard = (clientX: number, clientY: number) => {
    const rect = boardRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  };

  const toBoard = (e: React.MouseEvent): { x: number; y: number } => clientToBoard(e.clientX, e.clientY);

  const applyView = () => {
    const v = viewRef.current;
    rootRef.current?.style.setProperty("transform", `translate(${v.x}px,${v.y}px) scale(${v.k})`);
  };

  /** 边的贝塞尔路径(基于 dataRef 当前几何)。 */
  const edgePath = (e: JCEdge, nodes: JCNode[]): string | null => {
    const a = nodes.find((n) => n.id === e.fromNode);
    const b = nodes.find((n) => n.id === e.toNode);
    if (!a || !b) return null;
    const side1 = e.fromSide ?? "right";
    const side2 = e.toSide ?? "left";
    const [x1, y1] = SIDE_CENTER[side1](a);
    const [x2, y2] = SIDE_CENTER[side2](b);
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };

  /** 手势帧:把 dataRef 里的几何直写 DOM(卡片 style + 相连边 path),不触发 React。 */
  const syncGestureDom = () => {
    const d = dataRef.current;
    for (const n of d.nodes) {
      const el = cardElsRef.current.get(n.id);
      if (el) {
        el.style.left = `${n.x}px`;
        el.style.top = `${n.y}px`;
        el.style.width = `${n.width}px`;
        el.style.height = `${n.height}px`;
      }
    }
    for (const e of d.edges) {
      const el = edgeElsRef.current.get(e.id);
      const path = edgePath(e, d.nodes);
      if (el && path) el.setAttribute("d", path);
    }
  };

  const addNode = (partial: Partial<JCNode>, x = 120, y = 120) =>
    mutate((d) => ({
      ...d,
      nodes: [
        ...d.nodes,
        { id: uid("n"), type: "text", x, y, width: 240, height: 140, text: "双击编辑", ...partial } as JCNode,
      ],
    }));

  const addNoteRef = (notePath: string, x?: number, y?: number) =>
    addNode({ type: "file", file: notePath, height: 90, text: undefined } as Partial<JCNode>, x, y);

  /** 文件夹 → 分组卡(JSON Canvas group),作为承载容器。 */
  const addGroupRef = (label: string, x?: number, y?: number) =>
    addNode({ type: "group", label, width: 320, height: 220 } as Partial<JCNode>, x, y);

  /** 从白板新建文件(笔记/白板)并立即落一张引用卡。 */
  const createAndAdd = async (kind: "note" | "canvas", at?: { x: number; y: number } | null) => {
    const p = await onCreateFile(kind);
    if (p) addNoteRef(p, at ? Math.round(at.x - 120) : undefined, at ? Math.round(at.y - 45) : undefined);
  };

  /** 新建/引用今日每日笔记并落卡。 */
  const addDaily = async (at?: { x: number; y: number } | null) => {
    const p = await onCreateDaily();
    if (p) addNoteRef(p, at ? Math.round(at.x - 120) : undefined, at ? Math.round(at.y - 45) : undefined);
  };

  /** 引用面板条目 → 落卡(笔记/白板 → 文件卡;文件夹 → 分组卡)。 */
  const pickItem = (node: TreeNode, at: { x: number; y: number } | null) => {
    const x = at ? Math.round(at.x - 120) : undefined;
    const y = at ? Math.round(at.y - 45) : undefined;
    if (node.type === "dir") addGroupRef(node.name, at ? Math.round(at.x - 160) : undefined, at ? Math.round(at.y - 110) : undefined);
    else addNoteRef(node.path, x, y);
    setPick(null);
  };

  // 引用面板数据源
  const flatVault = useMemo(() => flatten(vault), [vault]);
  const pickLists = useMemo(
    () => ({
      note: flatVault.filter((n) => n.type === "note"),
      canvas: flatVault.filter((n) => n.type === "canvas"),
      dir: flatVault.filter((n) => n.type === "dir"),
    }),
    [flatVault]
  );

  /** 从左侧文件树拖入:笔记/白板 → 文件卡,文件夹 → 分组卡。 */
  const onDropItem = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    const p = e.dataTransfer.getData("text/mindbox-path");
    if (!p || !boardRef.current) return;
    const kind = e.dataTransfer.getData("text/mindbox-kind") || (p.endsWith(".canvas") ? "canvas" : "note");
    const pos = clientToBoard(e.clientX, e.clientY);
    if (kind === "dir") addGroupRef(p.split("/").pop() ?? p, Math.round(pos.x - 160), Math.round(pos.y - 110));
    else addNoteRef(p, Math.round(pos.x - 120), Math.round(pos.y - 45));
  };

  // 手势监听挂 window:拖出白板边界不丢手势
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const dg = dragRef.current;
        const n = dataRef.current.nodes.find((x) => x.id === dg.id);
        if (!n) return;
        const p = clientToBoard(e.clientX, e.clientY);
        n.x = Math.round(p.x - dg.dx);
        n.y = Math.round(p.y - dg.dy);
        dg.moved = true;
        syncGestureDom();
      } else if (resizeRef.current) {
        const rz = resizeRef.current;
        const n = dataRef.current.nodes.find((x) => x.id === rz.id);
        if (!n) return;
        const p = clientToBoard(e.clientX, e.clientY);
        n.width = Math.max(80, Math.round(p.x - n.x));
        n.height = Math.max(40, Math.round(p.y - n.y));
        rz.moved = true;
        syncGestureDom();
      } else if (linkRef.current) {
        const p = clientToBoard(e.clientX, e.clientY);
        tempLineRef.current?.setAttribute("x2", String(p.x));
        tempLineRef.current?.setAttribute("y2", String(p.y));
      } else if (panRef.current) {
        const v = viewRef.current;
        v.x += e.clientX - panRef.current.x;
        v.y += e.clientY - panRef.current.y;
        panRef.current = { x: e.clientX, y: e.clientY };
        applyView();
      }
    };
    const onUp = () => {
      if (dragRef.current || resizeRef.current) {
        if (dragRef.current?.moved || resizeRef.current?.moved) commitGesture();
        dragRef.current = null;
        resizeRef.current = null;
      }
      if (linkRef.current) {
        // 落点兜底:没落到目标卡片(卡片 onMouseUp 会先处理并置空)就取消
        linkRef.current = null;
        tempLineRef.current?.setAttribute("visibility", "hidden");
      }
      panRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [commitGesture]);

  const onWheel = (e: React.WheelEvent) => {
    const v = viewRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const k = Math.min(2.5, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    v.x = mx - ((mx - v.x) * k) / v.k;
    v.y = my - ((my - v.y) * k) / v.k;
    v.k = k;
    applyView();
  };

  const v = viewRef.current;
  // 分组卡(文件夹拖入)始终排在最底层,作为承载容器
  const orderedNodes = useMemo(
    () => [...data.nodes].sort((a, b) => (a.type === "group" ? 0 : 1) - (b.type === "group" ? 0 : 1)),
    [data.nodes]
  );

  /** 从四个方向柄之一开始连线(记录起点侧别,终点侧别按几何自动选)。 */
  const startLink = (c: JCNode, side: Side) => {
    const [sx, sy] = SIDE_CENTER[side](c);
    linkRef.current = { from: c.id, fromSide: side, sx, sy };
    const tl = tempLineRef.current;
    if (tl) {
      tl.setAttribute("x1", String(sx));
      tl.setAttribute("y1", String(sy));
      tl.setAttribute("x2", String(sx));
      tl.setAttribute("y2", String(sy));
      tl.setAttribute("visibility", "visible");
    }
  };

  const finishLink = (target: JCNode) => {
    const l = linkRef.current;
    if (!l || l.from === target.id) return;
    const side = (n: JCNode, px: number, py: number): Side => {
      const cx = n.x + n.width / 2;
      const cy = n.y + n.height / 2;
      return Math.abs(px - cx) > Math.abs(py - cy) ? (px > cx ? "right" : "left") : py > cy ? "bottom" : "top";
    };
    mutate((d) => ({
      ...d,
      edges: [
        ...d.edges,
        {
          id: uid("e"),
          fromNode: l.from,
          fromSide: l.fromSide,
          toNode: target.id,
          toSide: side(target, l.sx, l.sy),
        },
      ],
    }));
    linkRef.current = null;
    tempLineRef.current?.setAttribute("visibility", "hidden");
  };

  return (
    <main className="workarea">
      <header className="work-head">
        <span className="note-title">{name}</span>
        <span className={`save-status ${status}`}>
          {status === "saved" ? "已保存" : status === "saving" ? "保存中…" : "编辑中…"}
        </span>
        <div className="work-actions">
          <div className="pick-wrap" ref={pickRef}>
            <button
              className="icon-btn"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setPick((p) => (p ? null : { x: r.right - 180, y: r.bottom + 6, at: null, kind: "all" }));
              }}
              title="引用笔记 / 白板 / 文件夹到白板"
            >
              <IconLink />
            </button>
          </div>
        </div>
      </header>
      <div
        ref={boardRef}
        className="board"
        onMouseDown={(e) => {
          // 空白处按下 → 拖拽平移画布(卡片上按下由卡片自己处理)
          if ((e.target as HTMLElement).closest(".board-card")) return;
          panRef.current = { x: e.clientX, y: e.clientY };
        }}
        onWheel={onWheel}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest(".board-card")) return; // 卡片自带换色/删除菜单
          e.preventDefault();
          const p = clientToBoard(e.clientX, e.clientY);
          setBoardCtx({ x: e.clientX, y: e.clientY, bx: p.x, by: p.y });
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setDropActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current--;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDropActive(false);
          }
        }}
        onDrop={onDropItem}
        onDoubleClick={(e) => {
          const p = toBoard(e);
          addNode({}, Math.round(p.x - 120), Math.round(p.y - 70));
        }}
      >
        <div ref={rootRef} className="board-canvas" style={{ transform: `translate(${v.x}px,${v.y}px) scale(${v.k})` }}>
          <svg className="board-edges">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="currentColor" strokeWidth="2" />
              </marker>
            </defs>
            {data.edges.map((e) => {
              const d = edgePath(e, data.nodes);
              if (!d) return null;
              const color = e.color && PRESET_HEX[e.color] ? PRESET_HEX[e.color] : e.color;
              return (
                <g key={e.id} style={{ color: color ?? "var(--edge, #5a5a66)" }}>
                  <path
                    d={d}
                    ref={(el) => {
                      if (el) edgeElsRef.current.set(e.id, el);
                      else edgeElsRef.current.delete(e.id);
                    }}
                    className={`board-edge ${selected === e.id ? "selected" : ""}`}
                    style={{ stroke: color }}
                    markerEnd="url(#arrow)"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelected(e.id);
                    }}
                  />
                  {e.label && (
                    <text className="board-edge-label" onClick={(ev) => ev.stopPropagation()}>
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {/* 连线中的临时线:始终挂载,可见性由手势控制,避免额外渲染 */}
            <line ref={tempLineRef} className="board-edge temp" markerEnd="url(#arrow)" visibility="hidden" />
          </svg>

          {orderedNodes.map((c) => {
            const color = c.color && PRESET_HEX[c.color] ? PRESET_HEX[c.color] : c.color;
            const isGroup = c.type === "group";
            return (
              <div
                key={c.id}
                ref={(el) => {
                  if (el) cardElsRef.current.set(c.id, el);
                  else cardElsRef.current.delete(c.id);
                }}
                className={`board-card ${c.type} ${selected === c.id ? "selected" : ""} ${isGroup ? "group" : ""}`}
                style={{
                  left: c.x,
                  top: c.y,
                  width: c.width,
                  height: c.height,
                  ...(color ? { borderColor: color, boxShadow: selected === c.id ? `0 0 0 1px ${color}` : undefined } : {}),
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setSelected(c.id);
                  // 分组卡只在标签上按下才拖动(否则会挡住卡内双击建卡与卡片操作)
                  if (isGroup && !(e.target as HTMLElement).classList.contains("board-group-label")) return;
                  const p = toBoard(e);
                  dragRef.current = { id: c.id, dx: p.x - c.x, dy: p.y - c.y, moved: false };
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(c.id);
                  setCtx({ x: e.clientX, y: e.clientY, nodeId: c.id });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (c.type === "text") setEditing(c.id);
                  else if (c.type === "file" && c.file) onOpen(c.file);
                }}
                onMouseUp={(e) => {
                  const l = linkRef.current;
                  if (l && l.from !== c.id) finishLink(c); // 连线落点
                }}
              >
                {isGroup ? (
                  <div className="board-group-label">{c.label ?? ""}</div>
                ) : c.type === "file" ? (
                  <div className="board-note-card">
                    <span className="board-note-ico">{(c.file ?? "").endsWith(".canvas") ? "🗒" : "📄"}</span>
                    {(c.file ?? "").split("/").pop()?.replace(/\.(md|canvas)$/, "")}
                  </div>
                ) : c.type === "link" ? (
                  <div className="board-note-card">🔗 {c.url}</div>
                ) : editing === c.id ? (
                  <textarea
                    autoFocus
                    value={c.text}
                    onChange={(e) =>
                      mutate((d) => ({
                        ...d,
                        nodes: d.nodes.map((n) => (n.id === c.id ? { ...n, text: e.target.value } : n)),
                      }))
                    }
                    onMouseDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      setEditing(null);
                      mutate((d) => ({
                        ...d,
                        nodes: d.nodes.map((n) => (n.id === c.id ? { ...n, text: e.target.value } : n)),
                      }));
                    }}
                  />
                ) : (
                  <div className="board-card-text">{c.text}</div>
                )}
                {!isGroup && (
                  <>
                    {/* 四向连接柄:上/右/下/左,拖到目标卡片建立连线 */}
                    {SIDES.map((side) => (
                      <div
                        key={side}
                        className={`board-handle side-${side}`}
                        title={`从${side === "top" ? "上" : side === "right" ? "右" : side === "bottom" ? "下" : "左"}侧连线`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          startLink(c, side);
                        }}
                      />
                    ))}
                    {/* 缩放角 */}
                    <div
                      className="board-resize"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelected(c.id);
                        resizeRef.current = { id: c.id, moved: false };
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
        {dropActive && <div className="board-drop-hint" />}
      </div>

      {/* 空白处右键:建卡 / 建文件 / 引用文件树内容 */}
      {boardCtx && (
        <div className="ctx-menu" style={{ left: boardCtx.x, top: boardCtx.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => { addNode({}, Math.round(boardCtx.bx - 120), Math.round(boardCtx.by - 70)); setBoardCtx(null); }}>
            新建卡片
          </div>
          <div className="ctx-item" onClick={() => { addGroupRef("分组", Math.round(boardCtx.bx - 160), Math.round(boardCtx.by - 110)); setBoardCtx(null); }}>
            新建分组
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { const at = { x: boardCtx.bx, y: boardCtx.by }; setBoardCtx(null); void createAndAdd("note", at); }}>
            新建笔记并引用
          </div>
          <div className="ctx-item" onClick={() => { const at = { x: boardCtx.bx, y: boardCtx.by }; setBoardCtx(null); void createAndAdd("canvas", at); }}>
            新建白板并引用
          </div>
          <div className="ctx-item" onClick={() => { const at = { x: boardCtx.bx, y: boardCtx.by }; setBoardCtx(null); void addDaily(at); }}>
            今日每日笔记
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { setPick({ x: boardCtx.x, y: boardCtx.y, at: { x: boardCtx.bx, y: boardCtx.by }, kind: "note" }); setBoardCtx(null); }}>
            引用笔记…
          </div>
          <div className="ctx-item" onClick={() => { setPick({ x: boardCtx.x, y: boardCtx.y, at: { x: boardCtx.bx, y: boardCtx.by }, kind: "canvas" }); setBoardCtx(null); }}>
            引用白板…
          </div>
          <div className="ctx-item" onClick={() => { setPick({ x: boardCtx.x, y: boardCtx.y, at: { x: boardCtx.bx, y: boardCtx.by }, kind: "dir" }); setBoardCtx(null); }}>
            引用文件夹…
          </div>
        </div>
      )}

      {/* 引用面板:笔记 / 白板 / 文件夹 分组列出 */}
      {pick && (
        <div ref={pickPanelRef} className="ctx-menu pick-menu" style={{ left: pick.x, top: pick.y }} onMouseDown={(e) => e.stopPropagation()}>
          {(pick.kind === "all" || pick.kind === "note") && pickLists.note.length > 0 && (
            <>
              <div className="pick-head">笔记</div>
              {pickLists.note.map((n) => (
                <div key={n.path} className="ctx-item" onClick={() => pickItem(n, pick.at)}>
                  {n.name}
                </div>
              ))}
            </>
          )}
          {(pick.kind === "all" || pick.kind === "canvas") && pickLists.canvas.length > 0 && (
            <>
              {pick.kind === "all" && <div className="pick-sep" />}
              <div className="pick-head">白板</div>
              {pickLists.canvas.map((n) => (
                <div key={n.path} className="ctx-item" onClick={() => pickItem(n, pick.at)}>
                  🗒 {n.name}
                </div>
              ))}
            </>
          )}
          {(pick.kind === "all" || pick.kind === "dir") && pickLists.dir.length > 0 && (
            <>
              {pick.kind === "all" && <div className="pick-sep" />}
              <div className="pick-head">文件夹(落为分组)</div>
              {pickLists.dir.map((n) => (
                <div key={n.path} className="ctx-item" onClick={() => pickItem(n, pick.at)}>
                  📁 {n.name}
                </div>
              ))}
            </>
          )}
          {pick.kind === "all" && (
            <>
              <div className="pick-sep" />
              <div className="pick-head">每日笔记</div>
              <div className="ctx-item" onClick={() => { void addDaily(pick.at); setPick(null); }}>
                今日每日笔记
              </div>
            </>
          )}
        </div>
      )}

      {ctx && (
        <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-item head">颜色</div>
          <div className="ctx-colors">
            {PRESET.map((p) => (
              <span key={p} className="ctx-color" style={{ background: PRESET_HEX[p] }} onClick={() => { mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === ctx.nodeId ? { ...n, color: p } : n)) })); setCtx(null); }} />
            ))}
            <span className="ctx-color none" title="无颜色" onClick={() => { mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === ctx.nodeId ? { ...n, color: undefined } : n)) })); setCtx(null); }}>
              ×
            </span>
          </div>
          <div className="ctx-item" onClick={() => { mutate((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== ctx.nodeId), edges: d.edges.filter((e2) => e2.fromNode !== ctx.nodeId && e2.toNode !== ctx.nodeId) })); setCtx(null); }}>
            删除卡片
          </div>
        </div>
      )}

      <footer className="graph-foot">双击空白建卡 · 四向圆点连线 · 右键空白建卡/建文件/引用 · 拖文件树进来引用 · Delete 删除</footer>
    </main>
  );
}
