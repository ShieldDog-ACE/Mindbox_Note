"""Mindbox 后端入口:python3 run.py"""
import os
import sys
import threading
import time

import uvicorn

from app.core.config import HOST, PORT


def _watch_parent(interval: float = 2.0) -> None:
    """父进程(通常是 Electron)消失后自行退出。

    Electron 被 SIGKILL / 崩溃时不会执行任何清理,后端子进程会被 init 收养
    (ppid 变成 1)继续占着端口 —— 下次启动就会撞上"端口被占用",界面直接
    打不开。这里轮询 ppid 兜住这种情况。

    仅在启动时父进程真实存在(ppid != 1)时启用:直接从终端/nohup 拉起时
    父进程本来就是 1,不做判断,保持手动运行不被误杀。
    """
    if os.environ.get("MINDBOX_NO_PARENT_WATCH") == "1" or os.getppid() == 1:
        return

    def loop() -> None:
        while True:
            time.sleep(interval)
            if os.getppid() == 1:
                print("[mindbox] 父进程已退出,后端随之关闭", file=sys.stderr, flush=True)
                os._exit(0)

    threading.Thread(target=loop, daemon=True, name="mindbox-parent-watch").start()


if __name__ == "__main__":
    _watch_parent()
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=os.environ.get("MINDBOX_RELOAD") == "1",
        log_level=os.environ.get("MINDBOX_LOG", "warning"),
        access_log=False,
        # 显式锁定纯 Python 实现:不依赖 uvloop/httptools/websockets(已从未打包依赖中移除)
        loop="asyncio",
        http="h11",
        ws="none",
    )
