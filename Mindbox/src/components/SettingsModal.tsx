import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/** Obsidian 风格下拉框(带勾选标记,空间不足时向上弹出)。 */
function Dropdown<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = () => {
    if (!open) {
      const rect = ref.current?.getBoundingClientRect();
      setUp(!!rect && rect.bottom + 190 > window.innerHeight); // 下方放不下菜单则向上
    }
    setOpen(!open);
  };

  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className="dropdown-btn" onClick={toggle}>
        <span>{current}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className={`dropdown-menu ${up ? "up" : ""}`}>
          {options.map((o) => (
            <div
              key={o.value}
              className={`dropdown-item ${o.value === value ? "active" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  onClose: () => void;
  onRestored?: (path: string) => void; // 恢复后刷新已打开的标签
  onImported?: () => void; // 导入 zip 后刷新文件树
}

interface Settings {
  theme: "dark" | "light";
  fontSize: number;
  accent: string;
  fontFamily: "mono" | "sans"; // 编辑器字体
  lineHeight: number; // 编辑器行高
  readableWidth: boolean; // 阅读行宽限制(Obsidian readable line length)
  animations: boolean; // 界面动效
  graphLabels: "hover" | "always"; // 图谱节点标签显隐
  graphNodeScale: number; // 图谱节点大小倍率
  graphColorMode: "folder" | "custom"; // 图谱配色:目录 / 自定义
  graphNodeColor: string; // 自定义节点颜色
}

interface SnapFile {
  path: string;
  exists: boolean;
  count: number;
  latest: number;
}

const DEFAULTS: Settings = {
  theme: "dark",
  fontSize: 15,
  accent: "#a882ff",
  fontFamily: "mono",
  lineHeight: 1.7,
  readableWidth: true,
  animations: true,
  graphLabels: "always",
  graphNodeScale: 1,
  graphColorMode: "folder",
  graphNodeColor: "#a882ff",
};
const KEY = "mindbox-settings";

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

/** 设置应用:CSS 变量注入(主题/字号/强调色/字体/行高/行宽/动效/图谱标签)。 */
export function applySettings(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.anim = s.animations ? "on" : "off";
  root.dataset.graphLabels = s.graphLabels;
  root.dataset.readable = s.readableWidth ? "on" : "off";
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--accent-soft", hexToSoft(s.accent));
  root.style.setProperty("--font-size", `${s.fontSize}px`);
  root.style.setProperty(
    "--editor-font",
    s.fontFamily === "sans"
      ? "'Noto Sans CJK SC','PingFang SC',system-ui,sans-serif"
      : "'JetBrains Mono','Noto Sans Mono CJK SC',Consolas,monospace"
  );
  root.style.setProperty("--editor-lineheight", String(s.lineHeight));
}

function hexToSoft(hex: string): string {
  const m = /^#?([a-f\d]{6})$/i.exec(hex);
  if (!m) return "rgba(168,130,255,0.14)";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.14)`;
}

const fmtTs = (ts: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?$/.exec(ts);
  return m
    ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}${m[7] ? ` (#${Number(m[7]) + 1})` : ""}`
    : ts;
};

/** 文件恢复对话框:浏览快照 → 预览 → 恢复。 */
function RecoveryView({ onBack, onRestored }: { onBack: () => void; onRestored?: (p: string) => void }) {
  const [files, setFiles] = useState<SnapFile[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ ts: string; mtime: number; size: number }[]>([]);
  const [preview, setPreview] = useState<{ ts: string; content: string } | null>(null);
  const [msg, setMsg] = useState("");

  const loadFiles = () => api.snapshotFiles().then(setFiles).catch(() => setFiles([]));
  useEffect(() => {
    loadFiles();
  }, []);

  const openFile = (path: string) => {
    setSel(path);
    setPreview(null);
    setMsg("");
    api.snapshots(path).then(setVersions).catch(() => setVersions([]));
  };

  const openVersion = async (ts: string) => {
    if (!sel) return;
    try {
      const r = await api.readSnapshot(sel, ts);
      setPreview({ ts, content: r.content });
    } catch {
      setPreview(null);
    }
  };

  const restore = async () => {
    if (!sel || !preview) return;
    try {
      await api.restoreSnapshot(sel, preview.ts);
      setMsg(`已恢复 ${fmtTs(preview.ts)} 的版本`);
      onRestored?.(sel);
      api.snapshots(sel).then(setVersions).catch(() => {});
      setPreview(null);
    } catch (e) {
      setMsg("恢复失败:" + String(e));
    }
  };

  return (
    <div className="recovery">
      <div className="recovery-nav">
        <button className="btn" onClick={onBack}>
          ← 返回设置
        </button>
        <span className="panel-head">文件恢复 · 快照保留最近 20 版 / 每文件</span>
      </div>
      <div className="recovery-cols">
        <div className="recovery-files">
          {(files ?? []).map((f) => (
            <div key={f.path} className={`link-item ${sel === f.path ? "active" : ""}`} onClick={() => openFile(f.path)}>
              <div className="link-name">
                {f.path.split("/").pop()} {!f.exists && <em className="recovery-gone">(已删除)</em>}
              </div>
              <div className="link-ctx">
                {f.path} · {f.count} 个快照
              </div>
            </div>
          ))}
          {files !== null && files.length === 0 && <div className="empty-hint">还没有快照。编辑笔记后自动生成。</div>}
        </div>
        <div className="recovery-versions">
          {sel && (
            <>
              <div className="panel-head">{sel}</div>
              {versions.map((v) => (
                <div key={v.ts} className={`link-item ${preview?.ts === v.ts ? "active" : ""}`} onClick={() => openVersion(v.ts)}>
                  <div className="link-name">{fmtTs(v.ts)}</div>
                  <div className="link-ctx">{v.size} 字节</div>
                </div>
              ))}
              {preview && (
                <>
                  <pre className="meta-view recovery-preview">{preview.content.slice(0, 4000)}</pre>
                  <button className="btn primary" onClick={restore}>
                    恢复此版本
                  </button>
                </>
              )}
              {msg && <div className="link-ctx recovery-msg">{msg}</div>}
            </>
          )}
          {!sel && <div className="empty-hint">← 选择一个文件查看快照</div>}
        </div>
      </div>
    </div>
  );
}

/** Obsidian 风格开关。 */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="toggle-knob" />
    </button>
  );
}

/** 设置弹窗(Obsidian 风格)。 */
export default function SettingsModal({ onClose, onRestored, onImported }: Props) {
  const [s, setS] = useState<Settings>(loadSettings());
  const [view, setView] = useState<"main" | "recovery">("main");
  const [importMsg, setImportMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 导出:后端打 zip → 触发浏览器下载。 */
  const doExport = async () => {
    try {
      setBusy(true);
      const blob = await api.exportZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mindbox-notes.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setImportMsg("导出失败:" + String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 导入:zip 内全部条目作为新增写入,重名自动改名,绝不覆盖。 */
  const doImport = async (file: File) => {
    try {
      setBusy(true);
      setImportMsg("");
      const r = await api.importZip(file);
      setImportMsg(`已导入 ${r.imported} 个文件${r.skipped ? `(跳过 ${r.skipped} 个)` : ""}`);
      onImported?.();
    } catch (e) {
      setImportMsg("导入失败:" + String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    applySettings(s);
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new Event("mindbox-settings-changed")); // 图谱等视图实时响应
  }, [s]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (view === "recovery") setView("main");
      else onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [view, onClose]);

  return (
    <div className="palette-mask" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        {view === "recovery" ? (
          <RecoveryView onBack={() => setView("main")} onRestored={onRestored} />
        ) : (
          <>
            <header className="settings-head">设置</header>
            <section className="settings-row">
              <label>外观主题</label>
              <Dropdown
                value={s.theme}
                options={[
                  { value: "dark", label: "暗色" },
                  { value: "light", label: "亮色" },
                ]}
                onChange={(v) => setS({ ...s, theme: v })}
              />
            </section>
            <section className="settings-row">
              <label>正文字号 ({s.fontSize}px)</label>
              <input type="range" min={12} max={20} value={s.fontSize} onChange={(e) => setS({ ...s, fontSize: Number(e.target.value) })} />
            </section>
            <section className="settings-row">
              <label>强调色</label>
              <input type="color" value={s.accent} onChange={(e) => setS({ ...s, accent: e.target.value })} />
            </section>
            <section className="settings-row">
              <label>编辑器字体</label>
              <Dropdown
                value={s.fontFamily}
                options={[
                  { value: "mono", label: "等宽(代码风格)" },
                  { value: "sans", label: "无衬线(阅读友好)" },
                ]}
                onChange={(v) => setS({ ...s, fontFamily: v })}
              />
            </section>
            <section className="settings-row">
              <label>行高 ({s.lineHeight.toFixed(1)})</label>
              <input
                type="range"
                min={1.4}
                max={2.2}
                step={0.1}
                value={s.lineHeight}
                onChange={(e) => setS({ ...s, lineHeight: Number(e.target.value) })}
              />
            </section>
            <section className="settings-row">
              <label>限制阅读行宽(Obsidian 式)</label>
              <Toggle on={s.readableWidth} onChange={(v) => setS({ ...s, readableWidth: v })} />
            </section>
            <section className="settings-row">
              <label>界面动效</label>
              <Toggle on={s.animations} onChange={(v) => setS({ ...s, animations: v })} />
            </section>
            <section className="settings-row">
              <label>图谱节点标签</label>
              <Dropdown
                value={s.graphLabels}
                options={[
                  { value: "always", label: "始终显示" },
                  { value: "hover", label: "悬停显示" },
                ]}
                onChange={(v) => setS({ ...s, graphLabels: v })}
              />
            </section>
            <section className="settings-row">
              <label>图谱节点大小 ({s.graphNodeScale.toFixed(1)}×)</label>
              <input
                type="range"
                min={0.6}
                max={2}
                step={0.1}
                value={s.graphNodeScale}
                onChange={(e) => setS({ ...s, graphNodeScale: Number(e.target.value) })}
              />
            </section>
            <section className="settings-row">
              <label>图谱节点颜色</label>
              <span className="settings-inline">
                <Dropdown
                  value={s.graphColorMode}
                  options={[
                    { value: "folder", label: "按顶层目录" },
                    { value: "custom", label: "自定义颜色" },
                  ]}
                  onChange={(v) => setS({ ...s, graphColorMode: v })}
                />
                {s.graphColorMode === "custom" && (
                  <input type="color" value={s.graphNodeColor} onChange={(e) => setS({ ...s, graphNodeColor: e.target.value })} />
                )}
              </span>
            </section>
            <section className="settings-row">
              <label>核心功能</label>
              <button className="btn" onClick={() => setView("recovery")}>
                文件恢复
              </button>
            </section>
            <section className="settings-row">
              <label>笔记打包(zip)</label>
              <span className="settings-inline">
                <button className="btn" disabled={busy} onClick={doExport}>
                  导出笔记
                </button>
                <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
                  导入笔记
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".zip,application/zip"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) doImport(f);
                    e.target.value = "";
                  }}
                />
              </span>
            </section>
            {importMsg && (
              <section className="settings-note">
                {importMsg}
                {importMsg.startsWith("已导入") ? "(重名笔记自动改名新增,不覆盖)" : ""}
              </section>
            )}
            <section className="settings-note">
              快捷键:Ctrl+P 命令面板 · Ctrl+N 新建笔记 · Ctrl+Shift+N 白板 · Ctrl+D 每日笔记 · Ctrl+Shift+O 新建文件夹 · Ctrl+G 图谱 · Ctrl+E
              编辑/阅读 · Ctrl+W 关闭标签 · Ctrl+S 保存 · Ctrl+, 设置
            </section>
            <button className="btn primary" onClick={onClose}>
              完成
            </button>
          </>
        )}
      </div>
    </div>
  );
}
