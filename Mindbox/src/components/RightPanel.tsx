import { useEffect, useMemo, useState } from "react";
import type { SaveTick } from "../App";
import { api, Backlink, Outlink } from "../lib/api";
import { extractHeadings, Heading } from "../lib/md";

interface Props {
  activeNote: { path: string; meta: Record<string, unknown>; content: string } | null;
  onOpen: (ref: string) => void;
  saveTick?: SaveTick; // 保存信号:变化时刷新链接
  onJumpHeading?: (h: Heading) => void; // 大纲点击(编辑模式由 App 用编辑器注册表定位)
  onCollapse: () => void; // 收起面板
}

const TABS = ["大纲", "链接", "标签"] as const;
type TabKey = (typeof TABS)[number];

/** 右侧面板:大纲 + 链接系统(反链/出链) + 标签。默认收起,不挡编辑区。 */
export default function RightPanel({ activeNote, onOpen, saveTick, onJumpHeading, onCollapse }: Props) {
  const [tab, setTab] = useState<TabKey>("大纲");
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [outlinks, setOutlinks] = useState<Outlink[]>([]);
  const [tags, setTags] = useState<Record<string, number>>({});
  const [tagQuery, setTagQuery] = useState("");

  useEffect(() => {
    if (tab === "标签") api.tags().then(setTags).catch(() => setTags({}));
  }, [tab]);

  useEffect(() => {
    if (!activeNote?.path || tab !== "链接") {
      if (tab === "链接" && !activeNote?.path) {
        setBacklinks([]);
        setOutlinks([]);
      }
      return;
    }
    api.backlinks(activeNote.path).then(setBacklinks).catch(() => setBacklinks([]));
    api.outlinks(activeNote.path).then(setOutlinks).catch(() => setOutlinks([]));
  }, [tab, activeNote?.path, saveTick]);

  const outline = useMemo(
    () => (tab === "大纲" && activeNote ? extractHeadings(activeNote.content) : []),
    [tab, activeNote?.path, activeNote?.content] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const filteredTags = useMemo(
    () => Object.entries(tags).filter(([t]) => !tagQuery || t.includes(tagQuery)),
    [tags, tagQuery]
  );

  return (
    <aside className="rightpanel">
      <div className="rp-tabs">
        {TABS.map((t) => (
          <button key={t} className={`rp-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <button className="rp-collapse" title="收起面板" onClick={onCollapse}>
          »
        </button>
      </div>

      {tab === "大纲" && (
        <div className="outline-list">
          {outline.map((h, i) => (
            <div
              key={i}
              className={`outline-item h${h.level}`}
              onClick={() => {
                if (onJumpHeading) {
                  onJumpHeading(h);
                  return;
                }
                // 兜底:预览视图 DOM 锚点(id 生成规则见 md.ts)
                const id = `h-${encodeURIComponent(h.text.trim().replace(/\s+/g, "-"))}`;
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {h.text}
            </div>
          ))}
          {outline.length === 0 && <div className="empty-hint">当前笔记没有标题</div>}
        </div>
      )}

      {tab === "链接" && (
        <div className="link-list">
          <div className="panel-head">反向链接</div>
          {backlinks.map((b) => (
            <div key={b.source} className="link-item">
              <div className="link-name" onClick={() => onOpen(`wikilink:${b.source}`)}>
                {b.name}
              </div>
              {b.contexts.map((c, i) => (
                <div key={i} className="link-ctx">
                  {c}
                </div>
              ))}
            </div>
          ))}
          {backlinks.length === 0 && <div className="empty-hint">没有笔记链接到这里</div>}
          <div className="panel-head">出链</div>
          {outlinks.map((o) => (
            <div
              key={o.target}
              className={`link-item ${o.resolved ? "" : "unresolved"}`}
              onClick={() => onOpen(o.resolved ? `wikilink:${o.resolved}` : `create:${o.target}`)}
            >
              <div className="link-name">{o.target}</div>
              {!o.resolved && <div className="link-ctx">未创建,点击新建</div>}
            </div>
          ))}
          {outlinks.length === 0 && <div className="empty-hint">当前笔记没有出链</div>}
        </div>
      )}

      {tab === "标签" && (
        <div className="tag-panel">
          <input className="side-search" placeholder="过滤标签…" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} />
          <div className="tag-cloud">
            {filteredTags.map(([t, n]) => (
              <span key={t} className="tag-pill" onClick={() => onOpen(`tag:${t}`)}>
                #{t} <em>{n}</em>
              </span>
            ))}
            {filteredTags.length === 0 && <div className="empty-hint">库里还没有 #标签</div>}
          </div>
        </div>
      )}
    </aside>
  );
}
