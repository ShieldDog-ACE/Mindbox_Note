"""短期记忆(会话快照):每个会话一个 JSON,存上下文摘要/任务进度/结论。

存于 memory/short/sessions/{session_id}.json,与普通记忆条目分开。
"""
from __future__ import annotations

import json
import time

from ..core.config import VAULT_DIR  # noqa: F401  (保留:后续衰减任务引用)
from .memory_service import MEMORY_DIR

_EMPTY = {"summary": "", "tasks": [], "conclusions": []}


def _session_path(session_id: str):
    sid = "".join(c for c in session_id if c.isalnum() or c in "-_")[:64] or "default"
    d = MEMORY_DIR / "short" / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{sid}.json"


def get_session(session_id: str) -> dict:
    p = _session_path(session_id)
    if not p.is_file():
        return {"session_id": session_id, "exists": False, **_EMPTY}
    data = json.loads(p.read_text(encoding="utf-8"))
    data["exists"] = True
    return data


def update_session(
    session_id: str,
    summary: str | None = None,
    tasks: list | None = None,
    conclusions: list | None = None,
) -> dict:
    """增量更新会话快照;只传需要更新的字段。"""
    p = _session_path(session_id)
    data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {
        "session_id": session_id,
        "created_at": time.time(),
        **_EMPTY,
    }
    if summary is not None:
        data["summary"] = summary
    if tasks is not None:
        data["tasks"] = tasks
    if conclusions is not None:
        data["conclusions"] = conclusions
    data["updated_at"] = time.time()
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data
