/**
 * 开发启动器:并行跑 vite 与 electron(后端由 electron 主进程拉起)。
 * 用法:npm run dev
 */
const { spawn } = require("child_process");
const http = require("http");

const procs = [];
function run(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, {
    stdio: "inherit",
    shell: true,
    cwd: __dirname + "/..",
    env: { ...process.env, ...env },
  });
  p.on("exit", (code) => {
    console.log(`[${name}] exited (${code})`);
    shutdown();
  });
  procs.push(p);
}

function shutdown() {
  procs.forEach((p) => {
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  });
  process.exit(0);
}
process.on("SIGINT", shutdown);

/** 轮询 vite dev server,就绪后再开窗。
 *  旧实现写死等 2500ms —— 冷启动/慢盘上 vite 还没起来,Electron 就会加载失败出白屏。 */
function waitVite(port = 5173, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const retry = () => {
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tick, 200);
      };
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 800 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    tick();
  });
}

run("vite", "node node_modules/vite/bin/vite.js", []);
waitVite().then((ok) => {
  if (!ok) console.warn("[dev] vite 在 20 秒内未就绪,仍尝试打开窗口");
  run("electron", "node node_modules/electron/cli.js .", [], { MINDBOX_DEV: "1" });
});
