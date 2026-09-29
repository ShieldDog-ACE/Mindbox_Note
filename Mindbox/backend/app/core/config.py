"""集中配置:vault 路径、端口等。优先级 环境变量 > vault/config.json > 默认值。"""
import json
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # backend/
PROJECT_ROOT = BASE_DIR.parent  # Mindbox/

VAULT_DIR = Path(os.environ.get("MINDBOX_VAULT", PROJECT_ROOT / "vault"))

_cfg_path = VAULT_DIR / "config.json"
_cfg: dict = {}
if _cfg_path.exists():
    # 配置损坏(手改错/断电写坏)不能让后端整个起不来:退回默认值并告警。
    # 用户仍可在终端看到提示,但应用照常可用。
    try:
        _cfg = json.loads(_cfg_path.read_text(encoding="utf-8"))
        if not isinstance(_cfg, dict):
            print(f"[mindbox] config.json 顶层不是对象,已忽略:{_cfg_path}", file=sys.stderr)
            _cfg = {}
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
        print(f"[mindbox] config.json 解析失败({e}),使用默认配置:{_cfg_path}", file=sys.stderr)
        _cfg = {}

HOST = os.environ.get("MINDBOX_HOST", "127.0.0.1")
PORT = int(os.environ.get("MINDBOX_PORT", _cfg.get("port", 8765)))
API_PREFIX = "/api/v1"
# 版本号由 Electron 主进程注入(package.json 的 version);直接用 python 起后端(冒烟测试)
# 时退化成 "dev"。这样 /api/v1/system/health 一眼就能看出目标机上装的是哪一版。
APP_VERSION = os.environ.get("MINDBOX_APP_VERSION") or "dev"

# MCP 鉴权与访问控制(任务书第 6 节)
TOKEN = _cfg.get("token", "")
BLACKLIST: list[str] = _cfg.get("blacklist", [])  # vault 相对路径前缀黑名单

# 记忆引擎参数(集中定义,便于调参 —— 任务书 0.1 第 3 条)
MEMORY = {
    "promote_success_rate": 0.9,   # 成功率 > 90% 才可升级永久
    "promote_min_calls": 100,      # 且调用 > 100 次
    "confidence_pending": (60, 85),  # 待验证三元组置信度区间
    "short_term_ttl_days": 28,     # 短期任务记录保留 1-4 周
}

# 内置记忆文件夹:启动自动创建,前端/后端双重保护(不可删除/重命名)
MEMORY_FOLDERS = ["短期记忆", "长期记忆", "永久记忆"]
