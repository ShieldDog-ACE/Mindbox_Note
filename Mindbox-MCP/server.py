#!/usr/bin/env python3
"""Mindbox-MCP:三层记忆 MCP Server(stdio + JSON-RPC 2.0,零依赖)。

给 AI 用的"外部大脑"接口:任何支持 MCP 的客户端(Trae / Cursor / Claude Code /
CodeBuddy …)接进来,即可读写你的短期 / 长期 / 永久记忆。

- 传输:stdin/stdout 逐行 JSON-RPC(换行分隔),**日志一律走 stderr**,不污染协议流
- 方法:initialize / ping / tools/list / tools/call / notifications/*
- 工具采用注册表模式:新增工具只需往 TOOLS 字典加一项
- 三个记忆根文件夹受保护:MCP 无法删除它们,启动时缺失会自动重建
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Callable

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from memory_store import (  # noqa: E402
    LAYERS, LONG_CATEGORIES, add_item, add_triple, delete_item, ensure_dirs,
    overview, query, query_graph, session_close, session_open, session_update,
)

SERVER_NAME = "mindbox-memory"
SERVER_VERSION = "1.0.0测试版"
PROTOCOL_VERSION = "2025-06-18"

INSTRUCTIONS = """Mindbox 三层记忆(外部大脑)。

记忆分层与使用时机:
- 短期记忆:每个会话一份。开始任务先 session_open(会返回既有快照,可直接续接);
  过程中 session_update 记录上下文摘要、任务进度、中间结论;会话结束 session_close。
  目的是把状态外置到磁盘,压缩上下文、防遗忘。
- 长期记忆:存放"可能有用"的过渡条目(9 类),写入用 memory_add,检索用 memory_query。
- 永久记忆:已验证知识与三元组知识图,写入用 add_triple(置信度 ≥85),检索用 query_graph。

硬性规则:
1. 三个记忆根文件夹(短期记忆/长期记忆/永久记忆)不可删除,工具层已禁止。
2. 三元组置信度 <60 会被拒收,60-84 进长期待验证区,≥85 才进永久知识图。
3. 写入内容要精炼、自包含:它会在未来被别的 agent 在无上下文时读到。
4. 不确定的内容降低 confidence,不要为进永久而虚报置信度。
"""


def _log(msg: str) -> None:
    print(f"[mindbox-mcp] {msg}", file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# 工具注册表
# --------------------------------------------------------------------------

def _tool(name: str, desc: str, props: dict, required: list[str], handler: Callable) -> dict:
    return {
        "name": name,
        "description": desc,
        "inputSchema": {"type": "object", "properties": props, "required": required},
        "handler": handler,
    }


S, N, B, A = {"type": "string"}, {"type": "number"}, {"type": "boolean"}, {"type": "array"}
LAYER = {"type": "string", "enum": list(LAYERS)}

TOOLS: dict[str, dict] = {
    # ---------------- 概览 ----------------
    "memory_overview": _tool(
        "memory_overview", "三层记忆总览:会话数、各类条目数、三元组数、受保护文件夹状态",
        {}, [], overview),

    # ---------------- 短期记忆(会话作用域) ----------------
    "session_open": _tool(
        "session_open", "开启(或续接)一个会话的短期记忆:按 <agent>/<会话> 建文件夹,返回已有快照",
        {"agent": S, "session_id": S, "title": S, "summary": S},
        ["agent", "session_id"], session_open),
    "session_update": _tool(
        "session_update", "增量更新会话快照(只覆盖传入字段):summary/tasks/todos/conclusions/context",
        {"agent": S, "session_id": S, "summary": S, "tasks": A, "todos": A,
         "conclusions": A, "context": A, "status": S},
        ["agent", "session_id"], session_update),
    "session_close": _tool(
        "session_close", "结束会话并冻结快照;promote=true 时把中间结论转入长期记忆",
        {"agent": S, "session_id": S, "promote": B},
        ["agent", "session_id"], session_close),

    # ---------------- 长期 / 永久记忆条目 ----------------
    "memory_add": _tool(
        "memory_add", "写入一条记忆条目(长期 9 类 / 永久)。分类 key:" +
        " / ".join(f"{k}={v}" for k, v in LONG_CATEGORIES.items()),
        {"layer": LAYER, "category": S, "content": S, "confidence": N,
         "source": S, "tags": A},
        ["layer", "category", "content"], add_item),
    "memory_query": _tool(
        "memory_query", "中英文分词检索记忆(重合度 × 置信度排序);layer 省略则查长期+永久",
        {"keyword": S, "layer": LAYER, "top_k": N},
        ["keyword"], query),
    "memory_delete": _tool(
        "memory_delete", "删除单条记忆条目,用于纠错(三个记忆根文件夹受保护,不可删除)",
        {"layer": LAYER, "item_id": S}, ["layer", "item_id"], delete_item),

    # ---------------- 永久记忆:知识图 ----------------
    "add_triple": _tool(
        "add_triple", "加三元组 主语—[关系]→宾语。置信度 ≥85 进永久知识图,60-84 进长期待验证区,<60 拒收",
        {"subject": S, "relation": S, "object": S, "category": S,
         "confidence": N, "source": S},
        ["subject", "relation", "object"],
        lambda subject, relation, object, category="", confidence=70, source="":
            add_triple(subject, relation, object, category, confidence, source)),
    "query_graph": _tool(
        "query_graph", "在永久知识图上检索并沿关系边扩展 depth 圈(默认 1 圈)",
        {"keyword": S, "depth": N, "limit": N},
        ["keyword"], query_graph),
}


def _call_tool(name: str, args: dict) -> Any:
    tool = TOOLS.get(name)
    if tool is None:
        raise KeyError(f"未知工具:{name}")
    return tool["handler"](**args)


# --------------------------------------------------------------------------
# JSON-RPC
# --------------------------------------------------------------------------

def _send(payload: Any) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _error(code: int, message: str, rid: Any = None) -> dict:
    return {"jsonrpc": "2.0", "error": {"code": code, "message": message}, "id": rid}


def _result(rid: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "result": result, "id": rid}


def handle(msg: dict) -> dict | None:
    """处理单条 JSON-RPC 消息;通知类返回 None(不回包)。"""
    if not isinstance(msg, dict):
        return _error(-32600, "invalid request")

    method = msg.get("method", "")
    rid = msg.get("id")
    params = msg.get("params") or {}

    if method.startswith("notifications/"):
        return None

    if method == "initialize":
        client_ver = params.get("protocolVersion")
        result = {
            "protocolVersion": client_ver if isinstance(client_ver, str) else PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": INSTRUCTIONS,
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": [{k: t[k] for k in ("name", "description", "inputSchema")}
                            for t in TOOLS.values()]}
    elif method == "tools/call":
        name = params.get("name", "")
        try:
            data = _call_tool(name, params.get("arguments") or {})
            result = {
                "content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False, indent=2)}],
                "isError": False,
            }
        except Exception as exc:  # 工具级错误按 MCP 规范放进结果,不断连接
            _log(f"tool {name} failed: {exc}")
            result = {"content": [{"type": "text", "text": f"{type(exc).__name__}: {exc}"}],
                      "isError": True}
    else:
        return _error(-32601, f"method not found: {method}", rid)

    return _result(rid, result)


def serve() -> None:
    ensure_dirs()
    _log(f"ready · {SERVER_NAME} v{SERVER_VERSION} · 记忆根目录 = {ROOT}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            _send(_error(-32700, "parse error"))
            continue
        try:
            if isinstance(msg, list):  # JSON-RPC 批量
                replies = [r for r in (handle(m) for m in msg) if r is not None]
                if replies:
                    _send(replies)
            else:
                reply = handle(msg)
                if reply is not None:
                    _send(reply)
        except Exception as exc:  # 兜底:任何内部异常都不能打死服务
            _log(f"internal error: {exc}")
            _send(_error(-32603, f"internal error: {exc}",
                         msg.get("id") if isinstance(msg, dict) else None))
    _log("stdin closed, exit")


if __name__ == "__main__":
    if "--check" in sys.argv:
        print(json.dumps({"server": SERVER_NAME, "version": SERVER_VERSION,
                          "tools": len(TOOLS), "overview": overview()},
                         ensure_ascii=False, indent=2))
    else:
        try:
            serve()
        except KeyboardInterrupt:
            pass
