import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

let mainWindow;
let localServer;

async function createWindow() {
  process.env.PORT = "0";
  process.env.DATA_DIR = join(app.getPath("userData"), "data");
  process.env.APP_CONFIG_FILE = join(app.getPath("userData"), ".env");

  const { startServer } = await import("./server.mjs");
  const started = await startServer();
  localServer = started.server;

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#0b0d12",
    titleBarStyle: "hiddenInset",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(started.url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadURL(started.url);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  if (localServer?.listening) localServer.close();
});
