"""文件恢复快照:写入覆盖前自动留存旧版本到 vault/.snapshots/(Obsidian File Recovery 同思路)。

- 目录:.snapshots/<vault相对路径>/<时间戳>.md(镜像 vault 结构,天然无路径冲突)
- 节流:同一文件 60s 内不重复快照;内容与最新快照一致时跳过
- 上限:每文件最多保留 MAX_PER_FILE 份,超出淘汰最旧
"""
from __future__ import annotations

import time
from pathlib import Path

from ..core.config import VAULT_DIR

SNAP_DIR = VAULT_DIR / ".snapshots"
MAX_PER_FILE = 20
MIN_INTERVAL = 60  # 秒


def _snap_dir(rel: str) -> Path:
    return SNAP_DIR / rel


def snapshot_before_write(p: Path, rel: str, force: bool = False) -> None:
    """覆盖写入前调用:p 为将被打盘的文件绝对路径,rel 为 vault 相对路径。"""
    try:
        if not p.is_file():
            return
        d = _snap_dir(rel)
        d.mkdir(parents=True, exist_ok=True)
        current = p.read_text(encoding="utf-8")
        snaps = sorted(d.glob("*.md"))
        if snaps:
            newest = snaps[-1]
            try:
                if newest.read_text(encoding="utf-8") == current:
                    return  # 内容未变
            except OSError:
                pass
            if not force and time.time() - newest.stat().st_mtime < MIN_INTERVAL:
                return  # 节流窗口内
        base = time.strftime("%Y%m%d-%H%M%S")
        ts = base
        n = 1
        while (d / f"{ts}.md").exists():  # 同秒多次快照:加序号后缀防覆盖
            ts = f"{base}-{n}"
            n += 1
        (d / f"{ts}.md").write_text(current, encoding="utf-8")
        snaps = sorted(d.glob("*.md"))
        for old in snaps[:-MAX_PER_FILE]:
            old.unlink(missing_ok=True)
    except OSError:
        pass


def list_snapshots(rel: str) -> list[dict]:
    d = _snap_dir(rel)
    if not d.is_dir():
        return []
    out = []
    for f in sorted(d.glob("*.md"), reverse=True):
        try:
            st = f.stat()
            out.append({"ts": f.stem, "mtime": int(st.st_mtime), "size": st.st_size})
        except OSError:
            continue
    return out


def read_snapshot(rel: str, ts: str) -> str:
    f = _snap_dir(rel) / f"{ts}.md"
    if not f.is_file() or "/" in ts or ".." in ts:
        raise FileNotFoundError(ts)
    return f.read_text(encoding="utf-8")


def restore_snapshot(rel: str, ts: str) -> dict:
    """恢复指定版本:先把当前内容强制快照,再写回旧版本。"""
    p = VAULT_DIR / rel
    content = read_snapshot(rel, ts)
    if p.is_file():
        snapshot_before_write(p, rel, force=True)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return {"path": rel}


def snapshot_files() -> list[dict]:
    """有快照的文件列表(供恢复对话框)。.snapshots 镜像 vault 目录结构。"""
    out: list[dict] = []
    if not SNAP_DIR.is_dir():
        return out
    seen: set[str] = set()
    for f in SNAP_DIR.rglob("*.md"):
        if not f.is_file():  # 快照目录本身以 .md 结尾,rglob 会误匹配目录
            continue
        rel = f.parent.relative_to(SNAP_DIR).as_posix()
        if rel in seen:
            continue
        seen.add(rel)
        snaps = sorted(f.parent.glob("*.md"))
        out.append({
            "path": rel,
            "exists": (VAULT_DIR / rel).is_file(),
            "count": len(snaps),
            "latest": int(snaps[-1].stat().st_mtime),
        })
    out.sort(key=lambda x: -x["latest"])
    return out


def move_snapshots(old_rel: str, new_rel: str) -> None:
    """重命名/移动时同步迁移快照目录。"""
    old_d = SNAP_DIR / old_rel
    if not old_d.is_dir():
        return
    new_d = SNAP_DIR / new_rel
    try:
        new_d.parent.mkdir(parents=True, exist_ok=True)
        if new_d.exists():  # 目标已有快照则并入
            for f in old_d.glob("*.md"):
                f.replace(new_d / f.name)
            _prune_empty(old_d)
        else:
            old_d.rename(new_d)
            _prune_empty(old_d.parent)
    except OSError:
        pass


def _prune_empty(d: Path) -> None:
    """清理快照树里的空目录(不含 SNAP_DIR 本身)。"""
    try:
        while d != SNAP_DIR and d.is_dir() and not any(d.iterdir()):
            d.rmdir()
            d = d.parent
    except OSError:
        pass
