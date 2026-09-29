/**
 * Mindbox Electron 主进程。
 * 职责:拉起 Python 后端(sidecar) + 创建窗口。
 * 打包后布局:
 *   资源根 = process.resourcesPath
 *     ├── app.asar/dist/     渲染层(vite 产物)
 *     └── backend/           extraResources(mbpy + app + .pylibs)
 * 开发态根 = 项目目录。
 * 后端命令可被环境变量覆盖,为 PyInstaller 打包预留(任务书 0.1 第 4 条)。
 */
const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

// 单实例:重复启动(再点一次图标)时,把已开窗口调到最前而不是静默退出
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

const DEV_ROOT = path.join(__dirname, "..");
let win = null;
let backend = null;

// 笔记软件无 WebGL/视频硬解需求:关 GPU 加速可省掉整个 GPU 进程,显著降低内存占用。
// 代价是渲染全走 CPU(大图谱/长文档下 CPU 会偏高),所以留一个开关:
// MINDBOX_GPU=1 启动即启用硬件加速,便于低配/高配机器各自取舍。
if (process.env.MINDBOX_GPU !== "1") {
  app.disableHardwareAcceleration();
}
// Linux 上 Electron「窗口一片白」的两大常见成因,这里一次性规避:
//  1) /dev/shm 太小(容器或受限环境)→ 渲染进程拿不到共享内存,窗口全白;
//  2) 闭源显卡驱动(NVIDIA 等)下 GPU 合成失败 → 同样白窗。
// 两者都只是改用软件渲染/普通临时文件,不影响任何功能。
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("disable-gpu-compositing");

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : DEV_ROOT;
}

/**
 * 数据目录(vault)。必须放在 resources/ 之外——否则重装/重新打包会连人带库一起清掉。
 * 优先级:MINDBOX_VAULT 环境变量 > userData/vault(开发态用项目内 vault)。
 */
function vaultDir() {
  if (process.env.MINDBOX_VAULT) return process.env.MINDBOX_VAULT;
  return app.isPackaged ? path.join(app.getPath("userData"), "vault") : path.join(DEV_ROOT, "vault");
}

function backendCommand() {
  if (process.env.MINDBOX_BACKEND_CMD) {
    return { cmd: process.env.MINDBOX_BACKEND_CMD, args: [] };
  }
  const launcher = path.join(resourceRoot(), "backend", "mbpy");
  if (!fs.existsSync(launcher)) {
    console.error("[mindbox] backend launcher not found:", launcher);
    return null;
  }
  // mbpy 的 shebang 是 `#!/usr/bin/env python3`,会跟着 PATH 走。但 .pylibs 里是
  // cpython-312 的编译扩展(pydantic_core),落到 3.13/3.10 会直接崩。本机若装了
  // deadsnakes/conda/pyenv,交互式启动时很容易踩中 —— 所以显式挑系统解释器。
  if (process.env.MINDBOX_PYTHON) {
    return { cmd: process.env.MINDBOX_PYTHON, args: [launcher] };
  }
  const sysPy = ["/usr/bin/python3", "/usr/local/bin/python3", "/bin/python3"].find((p) => fs.existsSync(p));
  if (sysPy) return { cmd: sysPy, args: [launcher] };
  return { cmd: launcher, args: [] }; // 兜底:交给 shebang,按 PATH 找 python3
}

function startBackend() {
  const spec = backendCommand();
  if (!spec) return;
  const vault = vaultDir();
  fs.mkdirSync(vault, { recursive: true });
  console.log("[mindbox] starting backend:", spec.cmd, "vault:", vault);
  backend = spawn(spec.cmd, spec.args, {
    stdio: "inherit",
    // MINDBOX_APP_VERSION:把 package.json 的版本透给后端,/system/health 会回显,
    // 排查"用户装的是哪一版"时不用再去 grep 构件内容。
    env: { ...process.env, MINDBOX_VAULT: vault, MINDBOX_APP_VERSION: app.getVersion() },
  });
  backend.on("error", (e) => console.error("[mindbox] backend spawn failed:", e.message));
  backend.on("exit", (code) => console.log("[mindbox] backend exited:", code));
}

/** 后端端口:环境变量 > vault/config.json > 8765(与后端 config.py 同序)。 */
function backendPort() {
  if (process.env.MINDBOX_PORT) return Number(process.env.MINDBOX_PORT) || 8765;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(vaultDir(), "config.json"), "utf8"));
    if (cfg.port) return Number(cfg.port) || 8765;
  } catch {
    /* 没有 config.json:用默认端口 */
  }
  return 8765;
}

/** 探测该端口上是否已有后端在应答(带超时,不能拖住启动)。 */
function probeHealth(port, timeout = 700) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/v1/system/health", timeout },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** 等自家后端就绪;子进程一旦退出就立刻判失败,不空等到超时。 */
function waitBackendReady(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = async () => {
      if (backend && backend.exitCode !== null) return resolve(false);
      if (await probeHealth(port)) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 150); // 150ms 探测间隔:窗口已先开,只影响"后端就绪"判定精度
    };
    tick();
  });
}

/** 端口被陌生后端占用 / 自家后端起不来时要说的两段话。 */
function portBusyMessage(port) {
  return (
    `端口 ${port} 已被另一个程序占用，Mindbox 自带的后端无法启动。\n\n` +
    `（多半是之前残留了一个旧版 Mindbox 后端进程。界面如果连上它，\n` +
    `  会造成“功能缺失、操作报 404、笔记写到别处”这类怪现象。）\n\n` +
    `该进程通常属于 root，必须用 sudo 才能结束：\n\n` +
    `    sudo fuser -k ${port}/tcp          # 一行搞定\n\n` +
    `  或者先查再杀：\n` +
    `    sudo ss -ltnp | grep ${port}       # 看最后一列的 pid\n` +
    `    sudo kill -9 <pid>\n\n` +
    `如果当前账号没有 sudo 权限，重启一次电脑同样可以清掉它。`
  );
}

function backendFailedMessage(port) {
  return (
    `Mindbox 后端在 20 秒内没有就绪（端口 ${port}）。\n\n` +
    `常见原因：\n` +
    `  1) 端口被占用 —— sudo fuser -k ${port}/tcp\n` +
    `  2) 系统缺少 python3（本版本需要 3.12）\n\n` +
    `可在终端手动运行看具体报错：\n` +
    `    ${path.join(resourceRoot(), "backend", "mbpy")}`
  );
}

/** 渲染进程出问题时,把原因写进终端、并显示在窗口里 —— 白屏必须能被解释。 */
function wireRendererDiagnostics(w) {
  const wc = w.webContents;
  wc.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[mindbox][renderer:${level}] ${message}  @${String(sourceId).split("/").pop()}:${line}`);
  });
  wc.on("preload-error", (_e, preloadPath, error) => {
    console.error("[mindbox][renderer] preload 出错:", preloadPath, error && error.message);
  });
  wc.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[mindbox][renderer] 页面加载失败:", code, desc, url);
    showRenderError(w, `页面加载失败(${code} ${desc})\n${url}`);
  });
  wc.on("render-process-gone", (_e, details) => {
    console.error("[mindbox][renderer] 渲染进程结束:", JSON.stringify(details));
    showRenderError(w, `渲染进程异常结束:${details.reason}(exitCode=${details.exitCode})`);
  });
}

/** 用内联页面把错误显示在窗口里,替代毫无信息量的白屏。 */
function showRenderError(w, text) {
  const esc = String(text).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
  const html =
    "<html><head><meta charset='utf-8'></head><body style='margin:0;background:#1e1e22;color:#e8e8ea;font:14px/1.7 system-ui,sans-serif'>" +
    "<div style='padding:32px'><h2 style='font-weight:500'>Mindbox 界面加载失败</h2>" +
    "<pre style='white-space:pre-wrap;color:#ff9aa2'>" +
    esc +
    "</pre><p style='color:#9a9aa2'>把上面这段,连同终端里以 [mindbox] 开头的日志一起反馈即可定位。</p></div></body></html>";
  w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 960,
    backgroundColor: "#1e1e22",
    autoHideMenuBar: true,
    // 应用图标:开发态用 build/,打包后从 asar 内 dist/ 读取
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "app.asar", "dist", "icon.png")
      : path.join(DEV_ROOT, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  wireRendererDiagnostics(win);
  if (process.env.MINDBOX_DEV === "1") {
    win.loadURL("http://localhost:5173");
  } else if (app.isPackaged) {
    win.loadFile(path.join(process.resourcesPath, "app.asar", "dist", "index.html"));
  } else {
    win.loadFile(path.join(DEV_ROOT, "dist", "index.html"));
  }
  win.on("closed", () => (win = null));
}

app.whenReady().then(async () => {
  if (!gotLock) return; // 已有实例在跑,上面 second-instance 会唤起它的窗口

  const port = backendPort();
  const ownsBackend = app.isPackaged && !process.env.MINDBOX_BACKEND_CMD;

  // 先把窗口开出来,再并行去等后端。
  // 旧流程是「等后端就绪(实测冷启动 ~1.8s,还要按 300ms 轮询)才 createWindow」,
  // 期间用户盯着空桌面,表现为"启动极慢"。渲染层本来就有"后端没就绪就重试"的逻辑,
  // 窗口早开没有任何副作用。
  createWindow();

  if (!ownsBackend) return; // 开发态/外部后端:由调用方(MINDBOX_BACKEND_CMD)负责拉起

  // 打包态:若端口已被别的后端占着,界面会静默连到那个陌生后端,
  // 把笔记写进它自己的 vault,表现成"功能没了、操作 404"。宁可明确报错,也不带着故障跑。
  if (await probeHealth(port)) {
    dialog.showErrorBox("Mindbox 无法启动", portBusyMessage(port));
    app.quit();
    return;
  }

  startBackend();

  if (!(await waitBackendReady(port))) {
    dialog.showErrorBox("Mindbox 后端启动失败", backendFailedMessage(port));
    app.quit();
  }
});

app.on("will-quit", () => {
  // 兜底:任何退出路径都不要留下后端进程
  if (backend && backend.exitCode === null) backend.kill();
});

app.on("window-all-closed", () => {
  // 关窗前渲染层会用 fetch(keepalive) 把防抖中的修改补发出去,需要一点时间到达后端;
  // 立刻 kill 会把最后那笔保存丢掉。给 600ms 缓冲再收尾。
  const b = backend;
  backend = null;
  setTimeout(() => {
    if (b && b.exitCode === null) b.kill();
    app.quit();
  }, 600);
});
