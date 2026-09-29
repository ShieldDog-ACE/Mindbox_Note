/**
 * 笔记视图:源码编辑(CodeMirror)/阅读视图双模式。
 * 含:面包屑、悬停预览、![[嵌入]] 渲染、未解析双链点击创建、任务框交互。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, NoteData } from "../lib/api";
import Editor from "./Editor";
import { extractEmbeds, fillEmbeds, fillMath, fillMermaids, renderMarkdown, toggleTask } from "../lib/md";
import { IconEdit, IconRead } from "./icons";

export interface NoteTabData extends NoteData {}

interface Props {
  note: NoteTabData;
  mode: "edit" | "preview";
  onMode: (m: "edit" | "preview") => void;
  onChange: (content: string) => void;
  onOpen: (ref: string) => void;
  onOpenUnresolved: (title: string) => void;
  onSaveNow?: () => void; // Ctrl+S 立即落盘
  onRename?: (path: string, newName: string) => void; // 标题重命名(保留扩展名由 App 处理)
}

export default function NoteView({ note, mode, onMode, onChange, onOpen, onOpenUnresolved, onSaveNow, onRename }: Props) {
  const [html, setHtml] = useState("");
  const [hover, setHover] = useState<{ x: number; y: number; html: string } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const hoverTimer = useRef<number>();
  const hoverSeq = useRef(0);
  const previewRef = useRef<HTMLElement | null>(null);

  const breadcrumb = note.path.split("/").slice(0, -1).join(" / ");
  const baseName = note.name.replace(/\.\w+$/, ""); // 无扩展名标题

  /** Ctrl+S:立即落盘并给出「已保存」反馈。 */
  const doSave = useCallback(() => {
    onSaveNow?.();
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  }, [onSaveNow]);

  /** 标题重命名:回车/失焦提交,空值或未变则取消。 */
  const commitTitle = () => {
    setEditingTitle(false);
    const v = titleDraft.trim();
    if (v && v !== baseName) onRename?.(note.path, v);
  };

  // 阅读视图渲染(含嵌入异步填充)
  useEffect(() => {
    if (mode !== "preview") return;
    let alive = true;
    const seq = ++hoverSeq.current;
    (async () => {
      let h = renderMarkdown(note.content);
      if (extractEmbeds(note.content).length) h = await fillEmbeds(h);
      if (alive && seq === hoverSeq.current) {
        setHtml(h);
        // mermaid 图表与 KaTeX 公式在 DOM 挂载后异步渲染
        requestAnimationFrame(() => {
          const el = previewRef.current;
          if (el && alive) {
            fillMermaids(el);
            fillMath(el);
          }
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, note.content, note.path]);

  /** 双链点击:解析 → 打开;不存在 → 询问创建。 */
  const openWiki = useCallback(
    (raw: string) => {
      const [title, anchor] = raw.split("#");
      api.resolve(title.trim()).then((r) => {
        if (r.path) {
          onOpen(anchor ? `wikilink:${r.path}#${anchor}` : `wikilink:${title}`);
        } else {
          onOpenUnresolved(title.trim());
        }
      });
    },
    [onOpen, onOpenUnresolved]
  );

  // 悬停预览(600ms)
  const onPreviewOver = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a.wikilink") as HTMLElement | null;
    if (!a) return;
    const target = decodeURIComponent(a.dataset.target ?? "").split("#")[0];
    window.clearTimeout(hoverTimer.current); // 在链接内移动时重置,避免多个定时器叠加
    hoverTimer.current = window.setTimeout(async () => {
      try {
        const r = await api.resolve(target);
        if (!r.path) return;
        const n = await api.readNote(r.path);
        const rect = a.getBoundingClientRect();
        setHover({ x: rect.left, y: rect.bottom + 6, html: renderMarkdown(n.content.slice(0, 1200)) });
      } catch {
        /* 忽略 */
      }
    }, 600);
  };
  const clearHover = () => {
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  };

  // 卸载时清掉悬停定时器:否则 600ms 后会对已卸载组件 setState
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  return (
    <main className="workarea">
      <header className="work-head">
        <div className="head-title">
          {breadcrumb && <span className="crumb">{breadcrumb} / </span>}
          <span className="note-title">{note.name}</span>
        </div>
        <div className="work-actions">
          <button className={`icon-btn ${mode === "edit" ? "primary" : ""}`} onClick={() => onMode("edit")} title="编辑 (Ctrl+E 切换)">
            <IconEdit />
          </button>
          <button className={`icon-btn ${mode === "preview" ? "primary" : ""}`} onClick={() => onMode("preview")} title="阅读视图 (Ctrl+E 切换)">
            <IconRead />
          </button>
        </div>
      </header>
      {mode === "edit" ? (
        <>
          {/* 文档标题区:大字号 + 分隔线,点击可重命名;正文在下方区域直接输入 */}
          <div className="doc-title">
            {editingTitle ? (
              <input
                className="doc-title-input"
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
              />
            ) : (
              <span
                className="doc-title-text"
                title="点击重命名"
                onClick={() => {
                  setTitleDraft(baseName);
                  setEditingTitle(true);
                }}
              >
                {note.name}
              </span>
            )}
            {savedFlash && <span className="doc-title-hint saved">✓ 已保存</span>}
          </div>
          <Editor
            key={note.path}
            value={note.content}
            path={note.path}
            onChange={onChange}
            onOpenLink={(t) => openWiki(t)}
            onSave={doSave}
          />
        </>
      ) : (
        <div
          className="preview"
          ref={(el) => {
            previewRef.current = el;
          }}
          onMouseOver={onPreviewOver}
          onMouseOut={clearHover}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            const wiki = t.closest("a.wikilink") as HTMLElement | null;
            if (wiki) {
              openWiki(decodeURIComponent(wiki.dataset.target ?? ""));
              return;
            }
            const tag = t.closest("a.tag") as HTMLElement | null;
            if (tag) {
              onOpen(`tag:${tag.dataset.tag}`);
              return;
            }
            const check = t.closest("input.task-check") as HTMLInputElement | null;
            if (check) {
              const boxes = Array.from((t.closest(".preview") as HTMLElement).querySelectorAll("input.task-check"));
              const idx = boxes.indexOf(check);
              onChange(toggleTask(note.content, idx));
            }
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {hover && (
        <div
          className="hover-preview"
          style={{ left: hover.x, top: hover.y }}
          ref={(el) => {
            if (el) fillMath(el);
          }}
          onMouseLeave={clearHover}
          dangerouslySetInnerHTML={{ __html: hover.html }}
        />
      )}
    </main>
  );
}
