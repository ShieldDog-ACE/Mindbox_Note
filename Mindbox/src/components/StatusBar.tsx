import { useEffect, useState } from "react";
import type { SaveTick, Tab } from "../App";
import { api } from "../lib/api";
import { wordCount } from "../lib/md";
import { IconGear, IconPanel, IconSidebar } from "./icons";

interface Props {
  activeTab: Tab | null;
  saveTick: SaveTick;
  panelOpen: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
  onOpenSettings: () => void;
}

/** 底部状态栏:侧栏开关 / 字数 / 保存状态 / 面板与设置开关 / 后端指示灯。 */
export default function StatusBar({ activeTab, saveTick, panelOpen, sidebarOpen, onToggleSidebar, onTogglePanel, onOpenSettings }: Props) {
  const [savedAt, setSavedAt] = useState("");
  const [backend, setBackend] = useState<"ok" | "down">("ok");

  useEffect(() => {
    if (!saveTick.n) return;
    setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
  }, [saveTick.n]);

  useEffect(() => {
    const ping = () =>
      api
        .health()
        .then(() => setBackend("ok"))
        .catch(() => setBackend("down"));
    ping();
    const t = setInterval(ping, 30000);
    return () => clearInterval(t);
  }, []);

  const stats = activeTab?.kind === "note" ? wordCount(activeTab.content ?? "") : null;

  return (
    <footer className="statusbar">
      <span className="sb-left">
        <button className={`sb-btn ${sidebarOpen ? "active" : ""}`} onClick={onToggleSidebar} title="侧栏 (Ctrl+B)">
          <IconSidebar />
        </button>
        <span className="sb-path">{activeTab?.path ?? (activeTab ? activeTab.name : "就绪")}</span>
        {stats && <span className="sb-dim">{stats.words} 字</span>}
        {savedAt && <span className="sb-dim">已保存 {savedAt}</span>}
      </span>
      <span className="sb-right">
        <button className={`sb-btn ${panelOpen ? "active" : ""}`} onClick={onTogglePanel} title="大纲 / 链接 / 标签 (右侧面板)">
          <IconPanel />
        </button>
        <button className="sb-btn" onClick={onOpenSettings} title="设置 (Ctrl+,)">
          <IconGear />
        </button>
        <span className={`sb-dot ${backend}`} title={backend === "ok" ? "本地后端正常" : "后端离线,功能受限"} />
      </span>
    </footer>
  );
}
