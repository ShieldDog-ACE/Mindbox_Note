import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, GraphLink, GraphNode } from "../lib/api";
import { IconFocus, IconOrphan } from "./icons";
import { loadSettings } from "./SettingsModal";

interface Props {
  focusPath?: string; // 本地图谱中心(当前笔记)
  onOpen: (path: string) => void;
  onClose: () => void;
  /** 结构性变更版本号(新建/重命名/删除/移动/导入文件):变化即静默重拉图谱 */
  revision?: number;
  /** 保存信号:笔记/白板内容落盘后自增(白板内连线会派生出新的关系边) */
  saveTick?: number;
}

interface Sim extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

const FOLDER_COLORS = ["#a882ff", "#7fd3a8", "#ffb36b", "#7fb0ff", "#ff8fa3", "#e8d26a", "#6ad4d4", "#d69aff"];

/** 图谱数据指纹:完全一致时直接跳过,避免"无变更也重载/重排"。 */
const graphSignature = (g: { nodes: GraphNode[]; links: GraphLink[] }) =>
  g.nodes.map((n) => n.id).sort().join("|") +
  "#" +
  g.links.map((l) => `${l.source}>${l.target}:${l.kind ?? ""}:${l.from ?? ""}`).sort().join("|");

/** 节点个性化覆盖(右键小球设置):每节点颜色 + 大小倍率,持久化到 localStorage。 */
type NodeOverride = { color?: string; scale?: number };
const OVR_KEY = "mindbox-graph-node-overrides";
const loadOverrides = (): Record<string, NodeOverride> => {
  try {
    return JSON.parse(localStorage.getItem(OVR_KEY) ?? "{}");
  } catch {
    return {};
  }
};

/**
 * 关系图谱 v3:力导向 + SVG。
 * 性能:布局循环直接写 DOM(translate/x1y1x2y2),平移缩放同理,只在结构/高亮变化时走 React 渲染。
 * 交互:单击选中(高亮邻域),双击打开笔记(手动判定,抗布局漂移);拖拽带惯性,边界弹性反弹。
 */
export default function GraphView({ focusPath, onOpen, onClose, revision = 0, saveTick = 0 }: Props) {
  const [all, setAll] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  const [localMode, setLocalMode] = useState(!!focusPath);
  const [selected, setSelected] = useState<string | null>(null);
  const simsRef = useRef<Sim[]>([]);
  const [sims, setSims] = useState<Sim[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const stepRef = useRef<(() => void) | null>(null); // 布局循环体,静止后停表、交互时唤醒
  const signatureRef = useRef(""); // 已渲染数据的指纹,用于判断"是否真有变化"
  const svgRef = useRef<SVGSVGElement>(null);
  const rootGRef = useRef<SVGGElement>(null);
  const nodeElsRef = useRef<Map<string, SVGGElement>>(new Map());
  const lineElsRef = useRef<Map<number, SVGLineElement>>(new Map());
  const hitElsRef = useRef<Map<number, SVGLineElement>>(new Map()); // 连线的加宽命中层,随布局同步
  const centerRef = useRef({ x: 420, y: 300 });
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<Sim | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false); // 本次按下是否超过拖动阈值(区分点击与拖拽)
  const dragVelRef = useRef({ vx: 0, vy: 0 }); // 松手惯性
  const lastPtRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastClickRef = useRef<{ id: string; t: number } | null>(null); // 手动双击判定
  // 图谱自定义(节点大小/颜色),跟随设置实时生效
  const [gs, setGs] = useState(() => ({ scale: 1, colorMode: "folder" as "folder" | "custom", color: "#a882ff" }));
  // 每节点覆盖 + 右键弹窗
  const [ovr, setOvr] = useState<Record<string, NodeOverride>>(loadOverrides);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const nodeMenuRef = useRef<HTMLDivElement>(null);
  // 轻提示(操作结果反馈)
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };
  // 连接模式:从任意小球拖一条线到另一个小球建立关系(存 relations.json,不写笔记)
  const [linkMode, setLinkMode] = useState(false);
  const edgeDragRef = useRef<string | null>(null); // 拖线中的源节点 id
  const tempLineRef = useRef<SVGLineElement>(null);
  // 右键空白:新建小球(名字 + 类型)
  const [newNode, setNewNode] = useState<{ x: number; y: number } | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"note" | "canvas">("note");
  const newNodeRef = useRef<HTMLDivElement>(null);
  // 静默重建:关系变更后只局部更新连线,布局不再加热(球不因碰撞乱动)
  const quietRef = useRef(false);
  // Esc 统一处理:按优先级只做一件事。
  // 之前"退出连接模式"和"关闭关系网"是两个各自独立的 window keydown 监听,
  // 都不阻止对方 → 按一下 Esc 既退出连接模式、又把关系网标签关掉弹回笔记。
  // 这里合成一个,顺序:新建小球弹窗 > 右键菜单 > 连接模式 > 关闭关系网。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (newNode) {
        setNewNode(null);
        return;
      }
      if (nodeMenu) {
        setNodeMenu(null);
        return;
      }
      if (linkMode) {
        setLinkMode(false);
        edgeDragRef.current = null;
        if (tempLineRef.current) tempLineRef.current.style.display = "none";
        showToast("已退出连接模式");
        return;
      }
      // 焦点在输入框/编辑器内时不关闭整个关系网
      const tgt = e.target as HTMLElement | null;
      if (tgt?.closest?.("input, textarea, .cm-editor")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newNode, nodeMenu, linkMode, onClose]);

  // 新建小球弹窗:点击别处关闭(Esc 由上面的统一处理器负责)
  useEffect(() => {
    if (!newNode) return;
    const close = (e: MouseEvent) => {
      if (newNodeRef.current && !newNodeRef.current.contains(e.target as Node)) setNewNode(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [newNode]);

  const saveOvr = (id: string, patch: NodeOverride | null) => {
    setOvr((prev) => {
      const next = { ...prev };
      if (patch) next[id] = { ...next[id], ...patch };
      else delete next[id];
      localStorage.setItem(OVR_KEY, JSON.stringify(next));
      return next;
    });
  };

  // 右键弹窗:点击别处关闭(Esc 由上面的统一处理器负责)
  useEffect(() => {
    if (!nodeMenu) return;
    const close = (e: MouseEvent) => {
      if (nodeMenuRef.current && !nodeMenuRef.current.contains(e.target as Node)) setNodeMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [nodeMenu]);
  useEffect(() => {
    const sync = () => {
      const s = loadSettings();
      setGs({
        scale: s.graphNodeScale ?? 1,
        colorMode: s.graphColorMode ?? "folder",
        color: s.graphNodeColor ?? "#a882ff",
      });
    };
    sync();
    window.addEventListener("mindbox-settings-changed", sync);
    return () => window.removeEventListener("mindbox-settings-changed", sync);
  }, []);

  useEffect(() => {
    api.graph().then((g) => {
      signatureRef.current = graphSignature(g);
      setAll(g);
    });
  }, []);

  /** 重拉图谱。三点保证"该刷的刷、不该动的不动":
   *  1) 指纹比对 —— 数据与当前一致时直接返回,不 setState、不重排;
   *  2) 静默重建(quietRef)—— 真有变化时也保留已有节点坐标,球不会乱跳;
   *  3) 始终保留当前选中/高亮状态。
   */
  const pullGraph = useCallback(async () => {
    try {
      const g = await api.graph();
      const sig = graphSignature(g);
      if (sig === signatureRef.current) return; // 没有实际变化 → 保持现状
      signatureRef.current = sig;
      quietRef.current = true;
      setAll(g);
    } catch {
      /* 后端暂不可达:忽略,等下一次触发 */
    }
  }, []);

  // 变更订阅:结构性变更(revision:新建/重命名/删除/移动/导入)或内容落盘
  // (saveTick:笔记保存、白板内连线改动)都会触发。250ms 合并连续操作。
  useEffect(() => {
    if (!revision && !saveTick) return;
    const t = window.setTimeout(() => void pullGraph(), 250);
    return () => window.clearTimeout(t);
  }, [revision, saveTick, pullGraph]);

  // 兜底轮询:外部改动(MCP agent 写入、在文件管理器里改)不产生任何前端事件,
  // 只能靠它收敛。指纹一致时不做任何 setState,不会造成无谓重载或闪烁。
  useEffect(() => {
    const id = window.setInterval(() => void pullGraph(), 5000);
    return () => window.clearInterval(id);
  }, [pullGraph]);

  const noteTitle = (p: string) => p.split("/").pop()!.replace(/\.(md|canvas)$/, "");

  /** 建立/断开关系:走后端 relations.json(白板链接式,不碰笔记内容)。 */
  const setRelation = async (mode: "link" | "unlink", source: string, target: string) => {
    try {
      if (mode === "link") await api.createRelation(source, target);
      else await api.deleteRelation(source, target);
      showToast(
        mode === "link"
          ? `已建立关系:${noteTitle(source)} → ${noteTitle(target)}`
          : `已断开关系:${noteTitle(source)} - ${noteTitle(target)}`
      );
      // 局部更新连线并静默重建:不重新拉图谱、布局不加热,球保持原位不乱动
      quietRef.current = true;
      setAll((prev) => {
        const links =
          mode === "link"
            ? [...prev.links, { source, target, kind: "manual" as const }]
            : prev.links.filter(
                (l) => !((l.source === source && l.target === target) || (l.source === target && l.target === source))
              );
        const next = { nodes: prev.nodes, links };
        // 本地乐观变更也要同步"数据指纹",否则下一次拉取会把这份自己改过的状态
        // 误判成"服务端有新变化"而多刷一次(白挨一次重排)。
        signatureRef.current = graphSignature(next);
        return next;
      });
    } catch (e) {
      showToast(String(e).includes("409") ? "这两个小球已经连过了" : "操作失败:" + String(e));
    }
  };

  /** 右键空白 → 新建小球:按类型创建笔记/白板,刷新图谱并通知文件树。 */
  const createNode = async () => {
    const name = newName.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "");
    if (!name) return;
    const path = newKind === "canvas" ? `${name}.canvas` : `${name}.md`;
    try {
      await api.createNote(path, newKind === "canvas" ? JSON.stringify({ nodes: [], edges: [] }, null, 2) : "");
      setNewNode(null);
      setNewName("");
      showToast(`已创建 ${path}`);
      window.dispatchEvent(new CustomEvent("mindbox-vault-changed")); // 左侧文件树同步
      await pullGraph(); // 图谱立即反映(静默重建,已有节点保持原位)
    } catch (e) {
      showToast(String(e).includes("409") ? `${path} 已存在` : "创建失败:" + String(e));
    }
  };

  // 拖线落点判定:松手时命中哪个球,就与源球建立关系
  const edgeDrop = (sourceId: string, e: MouseEvent) => {
    const p = toSvg(e);
    for (const s of simsRef.current) {
      if (s.id === sourceId) continue;
      const hit = Math.max(6 + Math.min(s.degree ?? 0, 12) * 1.5, 18) + 6;
      if (Math.hypot(s.x - p.x, s.y - p.y) <= hit) {
        void setRelation("link", sourceId, s.id);
        return;
      }
    }
  };

  // 可见子图:全局 / 本地(一跳邻域) / 孤立
  const visible = useMemo(() => {
    let nodes = all.nodes;
    let links = all.links;
    if (localMode && focusPath) {
      const keep = new Set<string>([focusPath]);
      for (const l of links) {
        if (l.source === focusPath) keep.add(l.target);
        if (l.target === focusPath) keep.add(l.source);
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      links = links.filter((l) => keep.has(l.source) && keep.has(l.target));
    }
    if (onlyOrphans) {
      const linked = new Set<string>();
      for (const l of links) {
        linked.add(l.source);
        linked.add(l.target);
      }
      nodes = nodes.filter((n) => !linked.has(n.id));
      links = [];
    }
    return { nodes, links };
  }, [all, onlyOrphans, localMode, focusPath]);

  // 子图变化 → 重建模拟(以画布中心为圆心展开)
  useEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect && rect.width > 50) centerRef.current = { x: rect.width / 2, y: rect.height / 2 };
    const { x: cx, y: cy } = centerRef.current;
    const R = Math.min(340, 120 + visible.nodes.length * 18);
    const prevById = new Map(simsRef.current.map((s) => [s.id, s])); // O(1) 查旧坐标(原来是 O(n²))
    const prevNodeIds = simsRef.current.map((s) => s.id).join("|");
    const next: Sim[] = visible.nodes.map((n, i) => {
      const old = prevById.get(n.id);
      if (old) return { ...n, x: old.x, y: old.y, vx: 0, vy: 0 };
      const a = (2 * Math.PI * i) / Math.max(visible.nodes.length, 1);
      return { ...n, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, vx: 0, vy: 0 };
    });
    simsRef.current = next;
    setSims(next);
    linksRef.current = visible.links;
    // 只有「节点集合」变了才需要重新布局:
    //  - 节点增减/切换视图 → quiet 时轻加热(0.05,球基本不动),否则正常加热(1)
    //  - 仅边变化(连/断关系)→ 保持完全静止,连线由 React 直接重画,球一动不动
    const nodeSetChanged = prevNodeIds !== simsRef.current.map((s) => s.id).join("|");
    alphaRef.current = nodeSetChanged ? (quietRef.current ? 0.05 : 1) : Math.min(alphaRef.current, 0);
    quietRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 位置直接写 DOM,绕过 React 渲染(丝滑的关键)
  const syncDom = () => {
    const ns = simsRef.current;
    for (const n of ns) {
      nodeElsRef.current.get(n.id)?.setAttribute("transform", `translate(${n.x},${n.y})`);
    }
    const idx = new Map(ns.map((n) => [n.id, n]));
    const ls = linksRef.current;
    for (let i = 0; i < ls.length; i++) {
      const el = lineElsRef.current.get(i);
      const a = idx.get(ls[i].source);
      const b = idx.get(ls[i].target);
      if (!a || !b) continue;
      const hit = hitElsRef.current.get(i);
      for (const target of [el, hit]) {
        if (!target) continue;
        target.setAttribute("x1", String(a.x));
        target.setAttribute("y1", String(a.y));
        target.setAttribute("x2", String(b.x));
        target.setAttribute("y2", String(b.y));
      }
    }
  };

  const applyView = () => {
    const v = viewRef.current;
    rootGRef.current?.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`);
  };

  /** 唤醒布局循环。静止时循环会停表(不再每帧唤醒 CPU),拖拽/惯性时再启动。 */
  const wake = useCallback(() => {
    if (rafRef.current) return;
    const s = stepRef.current;
    if (s) rafRef.current = requestAnimationFrame(s);
  }, []);

  // 力导向模拟
  useEffect(() => {
    if (!sims.length) return;
    const step = () => {
      rafRef.current = 0; // 关键:先清标志,帧末按需重排
      const alpha = alphaRef.current;
      if (alpha > 0.005) {
        const ns = simsRef.current;
        let moving = dragRef.current != null; // 拖拽中始终同步
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const dx = ns[j].x - ns[i].x;
            const dy = ns[j].y - ns[i].y;
            const d2 = dx * dx + dy * dy || 1;
            const f = (2400 / d2) * alpha;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            ns[i].vx -= fx;
            ns[i].vy -= fy;
            ns[j].vx += fx;
            ns[j].vy += fy;
          }
        }
        const idx = new Map(ns.map((n, i) => [n.id, i]));
        for (const l of linksRef.current) {
          const a = ns[idx.get(l.source)!];
          const b = ns[idx.get(l.target)!];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 120) * 0.02 * alpha;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
        for (const n of ns) {
          n.vx += (centerRef.current.x - n.x) * 0.008 * alpha;
          n.vy += (centerRef.current.y - n.y) * 0.008 * alpha;
          if (n.fixed) {
            n.vx = 0;
            n.vy = 0;
            continue;
          }
          n.vx *= 0.85;
          n.vy *= 0.85;
          n.x += n.vx;
          n.y += n.vy;
          if (Math.abs(n.vx) > 0.05 || Math.abs(n.vy) > 0.05) moving = true;
        }
        // 视口边界:弹性反弹而非生硬卡停
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect && rect.width > 50) {
          const v = viewRef.current;
          const pad = 16;
          const L = -v.x / v.k + pad;
          const T = -v.y / v.k + pad;
          const R = (rect.width - v.x) / v.k - pad;
          const B = (rect.height - v.y) / v.k - pad;
          for (const n of ns) {
            if (n.fixed) continue;
            if (n.x < L) {
              n.x = L;
              n.vx = Math.abs(n.vx) * 0.6;
            } else if (n.x > R) {
              n.x = R;
              n.vx = -Math.abs(n.vx) * 0.6;
            }
            if (n.y < T) {
              n.y = T;
              n.vy = Math.abs(n.vy) * 0.6;
            } else if (n.y > B) {
              n.y = B;
              n.vy = -Math.abs(n.vy) * 0.6;
            }
          }
        }
        alphaRef.current = alpha * 0.98; // 衰减加快:约 3 秒静止
        if (moving) syncDom();
        // 仍在布局中 → 继续排帧;否则停表,不再空转占 CPU
        rafRef.current = requestAnimationFrame(step);
      }
    };
    stepRef.current = step;
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      stepRef.current = null;
    };
  }, [sims]);

  // 悬停完全交给 CSS(:hover + :has),滑动时零 React 渲染;选中(单击)才走 React 做邻域高亮
  const activeId = selected;
  // 邻域集合从 state(而不是 ref)推导:增删关系后能正确刷新,不会沿用旧高亮
  const neighbors = useMemo(() => {
    if (!activeId) return null;
    const set = new Set<string>([activeId]);
    for (const l of all.links) {
      if (l.source === activeId) set.add(l.target);
      if (l.target === activeId) set.add(l.source);
    }
    return set;
  }, [activeId, all.links]);

  const folderColor = (id: string) => {
    const folder = id.includes("/") ? id.split("/")[0] : "根目录";
    let h = 0;
    for (const c of folder) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return FOLDER_COLORS[h % FOLDER_COLORS.length];
  };

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (e.clientX - rect.left - v.x) / v.k, y: (e.clientY - rect.top - v.y) / v.k };
  };

  // 全局拖拽/平移:移出画布不丢手势;微动(<3px)不算拖拽,点击零扰动
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (edgeDragRef.current) {
        // 拖线模式:临时连线跟随光标(直接写 DOM,不走 React)
        const src = simsRef.current.find((s) => s.id === edgeDragRef.current);
        const el = tempLineRef.current;
        if (src && el) {
          const p = toSvg(e);
          el.style.display = "";
          el.setAttribute("x1", String(src.x));
          el.setAttribute("y1", String(src.y));
          el.setAttribute("x2", String(p.x));
          el.setAttribute("y2", String(p.y));
        }
      } else if (dragRef.current) {
        const d = downRef.current;
        if (!movedRef.current && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
        movedRef.current = true;
        const n = dragRef.current;
        const p = toSvg(e);
        n.x = p.x;
        n.y = p.y;
        n.fixed = true;
        alphaRef.current = Math.max(alphaRef.current, 0.25); // 只有真拖拽才唤醒布局
        wake(); // 静止期间循环已停表,这里重新启动
        const now = performance.now();
        const lp = lastPtRef.current;
        if (lp && now > lp.t) {
          const dt = Math.max(now - lp.t, 1);
          dragVelRef.current.vx = ((e.clientX - lp.x) / dt) * 16 / viewRef.current.k;
          dragVelRef.current.vy = ((e.clientY - lp.y) / dt) * 16 / viewRef.current.k;
        }
        lastPtRef.current = { x: e.clientX, y: e.clientY, t: now };
        syncDom();
      } else if (panRef.current) {
        viewRef.current.x += e.clientX - panRef.current.x;
        viewRef.current.y += e.clientY - panRef.current.y;
        panRef.current = { x: e.clientX, y: e.clientY };
        applyView();
      }
    };
    const onUp = (e: MouseEvent) => {
      if (edgeDragRef.current) {
        // 拖线松手:命中目标球则建立关系
        const srcId = edgeDragRef.current;
        edgeDragRef.current = null;
        if (tempLineRef.current) tempLineRef.current.style.display = "none";
        edgeDrop(srcId, e);
        return;
      }
      const n = dragRef.current;
      if (n) {
        n.fixed = false;
        if (movedRef.current) {
          // 拖拽松手:按最近速度惯性滑行 + 弹墙
          const cap = 36;
          n.vx = Math.max(-cap, Math.min(cap, dragVelRef.current.vx));
          n.vy = Math.max(-cap, Math.min(cap, dragVelRef.current.vy));
          alphaRef.current = Math.max(alphaRef.current, 0.5);
          wake(); // 惯性需要布局循环继续跑
        } else {
          n.vx = 0; // 纯点击:不扰动布局,双击不漂移
          n.vy = 0;
        }
      }
      dragRef.current = null;
      panRef.current = null;
      lastPtRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [wake]);

  const onWheel = (e: React.WheelEvent) => {
    const v = viewRef.current;
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const k = Math.min(3, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    v.x = mx - ((mx - v.x) * k) / v.k;
    v.y = my - ((my - v.y) * k) / v.k;
    v.k = k;
    applyView();
  };

  const v = viewRef.current;
  const links = linksRef.current;
  const idx = new Map(simsRef.current.map((n) => [n.id, n]));

  return (
    <main className="workarea">
      <header className="work-head">
        <span className="note-title">{localMode && focusPath ? `本地图谱 · ${focusPath.split("/").pop()!.replace(/\.md$/, "")}` : "关系图谱"}</span>
        <div className="work-actions">
          <button className={`icon-btn ${localMode ? "primary" : ""}`} onClick={() => setLocalMode((v) => !v)} disabled={!focusPath} title="本地图谱:当前笔记的邻域">
            <IconFocus />
          </button>
          <button className={`icon-btn ${onlyOrphans ? "primary" : ""}`} onClick={() => setOnlyOrphans((v) => !v)} title="只看孤立笔记(无链接)">
            <IconOrphan />
          </button>
        </div>
      </header>
      <svg
        ref={svgRef}
        className={`graph-svg ${linkMode ? "link-mode" : ""}`}
        onWheel={onWheel}
        onMouseDown={(e) => {
          if (e.button === 0) panRef.current = { x: e.clientX, y: e.clientY }; // 右键留给新建菜单
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setNewName("");
          setNewKind("note");
          setNewNode({ x: e.clientX, y: e.clientY });
        }}
      >
        <g ref={rootGRef} transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
          {links.map((l, i) => {
            const a = idx.get(l.source);
            const b = idx.get(l.target);
            if (!a || !b) return null;
            const dim = neighbors && !(neighbors.has(l.source) && neighbors.has(l.target));
            const focusEdge = l.source === selected || l.target === selected;
            return (
              <g key={i} className="edge-group">
                <line
                  ref={(el) => {
                    if (el) lineElsRef.current.set(i, el);
                    else lineElsRef.current.delete(i);
                  }}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  className={`graph-edge ${focusEdge ? "focus" : ""} ${dim ? "dim" : ""} ${l.kind === "canvas" ? "canvas" : ""}`}
                />
                {/* 加宽透明命中层:点击连线即断开关系 */}
                <line
                  ref={(el) => {
                    if (el) hitElsRef.current.set(i, el);
                    else hitElsRef.current.delete(i);
                  }}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  className="graph-edge-hit"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    // 白板派生的关系在 relations.json 里没有记录,断它会 404;直接引导去白板改
                    if (l.kind === "canvas") {
                      showToast(
                        `该关系来自白板「${l.from ?? ""}」内的连线,请打开白板删除那条连线`
                      );
                      return;
                    }
                    void setRelation("unlink", l.source, l.target);
                  }}
                />
              </g>
            );
          })}
          {/* 连接模式:拖线中的临时连线 */}
          <line ref={tempLineRef} className="graph-edge-temp" style={{ display: "none" }} />
          {simsRef.current.map((n) => {
            const o = ovr[n.id] ?? {};
            const r = (6 + Math.min(n.degree ?? 0, 12) * 1.5) * gs.scale * (o.scale ?? 1);
            const hit = Math.max(r + 10, 18); // 碰撞箱半径:大于球体,悬停判定宽松且不重叠
            const dim = neighbors && !neighbors.has(n.id);
            const focus = n.id === activeId;
            const col = o.color ?? (gs.colorMode === "custom" ? gs.color : folderColor(n.id));
            return (
              <g
                key={n.id}
                ref={(el) => {
                  if (el) nodeElsRef.current.set(n.id, el);
                  else nodeElsRef.current.delete(n.id);
                }}
                transform={`translate(${n.x},${n.y})`}
                className={`graph-node ${dim ? "dim" : ""} ${focus ? "focus" : ""}`}
                onMouseDown={(e) => {
                  if (e.button !== 0) return; // 右键交给弹窗,不启动拖拽
                  e.stopPropagation();
                  if (linkMode) {
                    // 连接模式:从该球拖出一条线
                    edgeDragRef.current = n.id;
                    return;
                  }
                  dragRef.current = n;
                  downRef.current = { x: e.clientX, y: e.clientY };
                  lastPtRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
                  dragVelRef.current = { vx: 0, vy: 0 };
                  movedRef.current = false;
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(n.id);
                  setNodeMenu({ x: e.clientX, y: e.clientY, id: n.id });
                }}
                onClick={() => {
                  // 连接模式:单击只选中,绝不触发"打开笔记" —— 否则连线途中手一抖就被弹回笔记
                  if (linkMode) {
                    setSelected(n.id);
                    lastClickRef.current = null;
                    return;
                  }
                  // 拖拽不算点击;单击选中;350ms 内同节点二击 = 打开(手动判定,节点漂移也不丢)
                  if (movedRef.current) return;
                  const now = performance.now();
                  const last = lastClickRef.current;
                  if (last && last.id === n.id && now - last.t < 350) {
                    lastClickRef.current = null;
                    if (!n.missing) onOpen(n.id);
                  } else {
                    lastClickRef.current = { id: n.id, t: now };
                    setSelected(n.id);
                  }
                }}
              >
                {/* 碰撞箱:透明捕获层,悬停/离开判定全看它(球体本身缩放不影响判定面积) */}
                <circle r={hit} fill="transparent" className="graph-hit" />
                <circle r={r} fill={col} style={{ color: col }} className={n.missing ? "graph-dot missing" : "graph-dot"} />
                <text y={r + 13} textAnchor="middle" className="graph-label">
                  {n.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {nodeMenu && (
        <div
          ref={nodeMenuRef}
          className="ctx-menu node-menu"
          style={{
            left: Math.min(nodeMenu.x, window.innerWidth - 220),
            top: Math.min(nodeMenu.y, window.innerHeight - 170),
          }}
        >
          <div className="ctx-item head">{nodeMenu.id.split("/").pop()!.replace(/\.(md|canvas)$/, "")}</div>
          <label className="node-menu-row">
            颜色
            <input
              type="color"
              value={ovr[nodeMenu.id]?.color ?? (gs.colorMode === "custom" ? gs.color : folderColor(nodeMenu.id))}
              onChange={(e) => saveOvr(nodeMenu.id, { color: e.target.value })}
            />
          </label>
          <label className="node-menu-row">
            大小 {((ovr[nodeMenu.id]?.scale ?? 1) * 100).toFixed(0)}%
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.1}
              value={ovr[nodeMenu.id]?.scale ?? 1}
              onChange={(e) => saveOvr(nodeMenu.id, { scale: Number(e.target.value) })}
            />
          </label>
          <div
            className="ctx-item"
            onClick={() => {
              setLinkMode(true);
              setNodeMenu(null);
              showToast("连接模式:从任意小球拖一条线到另一个小球即可建立关系(按 Esc 退出连接模式)");
            }}
          >
            建立关系
          </div>
          <div
            className="ctx-item"
            onClick={() => {
              saveOvr(nodeMenu.id, null);
              setNodeMenu(null);
            }}
          >
            恢复默认
          </div>
        </div>
      )}
      {newNode && (
        <div
          ref={newNodeRef}
          className="ctx-menu node-menu"
          style={{
            left: Math.min(newNode.x, window.innerWidth - 220),
            top: Math.min(newNode.y, window.innerHeight - 190),
          }}
        >
          <div className="ctx-item head">新建小球</div>
          <input
            className="node-menu-input"
            autoFocus
            placeholder="名字"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createNode();
            }}
          />
          <div className="node-menu-row node-kind-row">
            <label>
              <input type="radio" checked={newKind === "note"} onChange={() => setNewKind("note")} />
              笔记
            </label>
            <label>
              <input type="radio" checked={newKind === "canvas"} onChange={() => setNewKind("canvas")} />
              白板
            </label>
          </div>
          <div className="ctx-item" onClick={() => void createNode()}>
            创建
          </div>
        </div>
      )}
      {toast && <div className="graph-toast">{toast}</div>}
      <footer className="graph-foot">
        拖动节点(松手带惯性) · 滚轮缩放 · 左键拖空白平移 · 单击选中 · 双击打开 · 右键小球:颜色/大小/建立关系 · 右键空白:新建小球 · 点击连线:断开关系 · Esc:先退出连接模式,再按一次返回笔记
      </footer>
    </main>
  );
}
