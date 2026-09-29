import { useEffect, useMemo, useRef, useState } from "react";
import { TreeNode } from "../lib/api";

export interface Command {
  id: string;
  label: string;
  hint?: string;
}

interface Props {
  tree: TreeNode[];
  commands: Command[];
  onPick: (path: string) => void;
  onCommand: (id: string) => void;
  onClose: () => void;
}

function collectNotes(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    if (n.type === "note") out.push(n);
    if (n.children) collectNotes(n.children, out);
  }
  return out;
}

/**
 * Ctrl+P 快速切换面板。
 * 输入 ">" 进入命令模式(新建/图谱/切换视图),否则搜笔记。
 */
export default function CommandPalette({ tree, commands, onPick, onCommand, onClose }: Props) {
  const notes = useMemo(() => collectNotes(tree), [tree]);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const isCmd = q.startsWith(">");
  const cmdQuery = q.slice(1).trim();
  const filteredCmds = useMemo(
    () => (cmdQuery ? commands.filter((c) => c.label.toLowerCase().includes(cmdQuery.toLowerCase())) : commands),
    [commands, cmdQuery]
  );
  const filteredNotes = useMemo(
    () => (q && !isCmd ? notes.filter((n) => n.name.toLowerCase().includes(q.toLowerCase())) : notes).slice(0, 12),
    [notes, q, isCmd]
  );
  const total = isCmd ? filteredCmds.length : filteredNotes.length;

  const commit = (i: number) => {
    if (isCmd) {
      if (filteredCmds[i]) onCommand(filteredCmds[i].id);
    } else if (filteredNotes[i]) onPick(filteredNotes[i].path);
  };

  return (
    <div className="palette-mask" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="跳转到笔记,或输入 > 执行命令…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation(); // 只关面板,不穿透到底下的视图(图谱/白板)
              onClose();
            }
            if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, total - 1));
            if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
            if (e.key === "Enter") commit(idx);
          }}
        />
        <div className="palette-list">
          {isCmd
            ? filteredCmds.map((c, i) => (
                <div
                  key={c.id}
                  className={`palette-item ${i === idx ? "active" : ""}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => onCommand(c.id)}
                >
                  {c.label}
                  {c.hint && <span className="palette-path">{c.hint}</span>}
                </div>
              ))
            : filteredNotes.map((n, i) => (
                <div
                  key={n.path}
                  className={`palette-item ${i === idx ? "active" : ""}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => onPick(n.path)}
                >
                  {n.name}
                  <span className="palette-path">{n.path}</span>
                </div>
              ))}
          {total === 0 && <div className="empty-hint">{isCmd ? "无匹配命令" : "无匹配笔记"}</div>}
        </div>
      </div>
    </div>
  );
}
