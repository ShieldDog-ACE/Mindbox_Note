/**
 * 全局搜索视图(Obsidian 搜索面板):
 * 全文多片段结果 + 行号 + 命中高亮;`tag:#xxx` 前缀走标签检索。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, SearchResult } from "../lib/api";

interface Props {
  seed: { q: string; n: number }; // 外部(Ctrl+Shift+F / 标签点击)注入的查询
  onOpen: (path: string) => void;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function SearchView({ seed, onOpen }: Props) {
  const [query, setQuery] = useState(seed.q);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (seed.n > 0) {
      setQuery(seed.q);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed.n]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(() => {
      const done = () => setBusy(false);
      if (q.startsWith("tag:")) {
        const tag = q.slice(4).replace(/^#+/, "");
        api
          .tagNotes(tag)
          .then((ns) => setResults(ns.map((n) => ({ path: n.path, name: n.name, count: 1, score: 1, snippets: [] }))))
          .catch(() => setResults([]))
          .finally(done);
      } else {
        api.search(q).then(setResults).catch(() => setResults([])).finally(done);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const tokens = useMemo(
    () => (query.trim().startsWith("tag:") ? [] : query.trim().split(/\s+/).filter(Boolean)),
    [query]
  );

  // split + 捕获组:奇数位即命中片段,直接包 <mark>(避免全局正则 lastIndex 污染)
  const highlight = (text: string) => {
    if (!tokens.length) return text;
    const re = new RegExp(`(${tokens.map(escapeRe).join("|")})`, "gi");
    return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
  };

  const fileCount = results.length;
  const matchCount = results.reduce((s, r) => s + r.count, 0);

  return (
    <main className="workarea search-view">
      <div className="search-head">
        <input
          ref={inputRef}
          className="search-input"
          autoFocus
          placeholder="搜索全文…(tag:#标签 检索标签,Enter 打开首条)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) onOpen(results[0].path);
          }}
        />
        <div className="search-meta">
          {query.trim() ? (busy ? "搜索中…" : `${matchCount} 个命中 · ${fileCount} 个文件`) : "输入关键词,或 tag:#标签名"}
        </div>
      </div>
      <div className="search-results">
        {results.map((r) => (
          <div key={r.path} className="search-file" onClick={() => onOpen(r.path)}>
            <div className="search-file-head">
              <span className="hit-name">{r.name}</span>
              <span className="search-file-path">{r.path}</span>
              {r.count > 1 && <span className="search-count">{r.count}</span>}
            </div>
            {r.snippets.map((s, i) => (
              <div key={i} className="search-snippet">
                <span className="search-line">:{s.line}</span>
                <span className="search-text">{highlight(s.text)}</span>
              </div>
            ))}
          </div>
        ))}
        {query.trim() && !busy && results.length === 0 && <div className="empty-hint">没有匹配结果</div>}
      </div>
    </main>
  );
}
