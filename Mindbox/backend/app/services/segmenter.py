"""分词服务:中文 jieba + 英文按词。搜索与记忆检索共用,保证全文口径一致。

jieba 导入本身要 ~200ms(其中它依赖的 pkg_resources 就占 150ms+),而分词只在
"搜索 / 记忆检索 / 标签匹配"时才真正用到。因此改成首次调用再导入:
后端冷启动省下这部分,代价只是第一次搜索多 0.2 秒(一次性)。
"""
from __future__ import annotations

_jieba = None


def _load():
    """惰性导入 jieba(线程安全:Python 导入锁保证只真正执行一次)。"""
    global _jieba
    if _jieba is None:
        import jieba

        jieba.setLogLevel(60)  # 关闭构建词典的日志噪音
        _jieba = jieba
    return _jieba


def tokenize(text: str) -> list[str]:
    """搜索引擎模式分词,过滤空白。"""
    jieba = _load()
    return [t.strip() for t in jieba.cut_for_search(text) if t.strip()]
