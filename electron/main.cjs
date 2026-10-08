const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} = require("electron");
const path = require("node:path");
const { ActivityService } = require("./activity-service.cjs");

const isMac = process.platform === "darwin";
let mainWindow;
let widgetWindow;
let tray;
let trayMenu;
let activity;
let quitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    title: "AWScreen",
    backgroundColor: "#f4f5f2",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));
  mainWindow.on("close", (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createWidgetWindow() {
  if (widgetWindow) return widgetWindow;

  widgetWindow = new BrowserWindow({
    width: 310,
    height: 390,
    minWidth: 290,
    maxWidth: 360,
    minHeight: 340,
    maxHeight: 480,
    title: "AWScreen Widget",
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  widgetWindow.loadFile(path.join(__dirname, "..", "src", "widget.html"));
  widgetWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      setWidgetVisible(false);
    }
  });
  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });
  return widgetWindow;
}

function setWidgetVisible(visible, persist = true) {
  if (visible) {
    const widget = createWidgetWindow();
    widget.show();
    widget.focus();
  } else {
    widgetWindow?.hide();
  }
  mainWindow?.webContents.send("widget:visibility", visible);
  widgetWindow?.webContents.send("widget:visibility", visible);
  const widgetMenuItem = trayMenu?.getMenuItemById("widget-toggle");
  if (widgetMenuItem) widgetMenuItem.checked = visible;
  if (persist && activity && activity.settings.widgetVisible !== visible) {
    activity.updateSettings({ widgetVisible: visible });
  }
}

function updateTrayTopApps(state) {
  if (!trayMenu) return;
  const apps = state?.summary?.apps || [];
  for (let index = 0; index < 3; index += 1) {
    const item = trayMenu.getMenuItemById(`top-app-${index}`);
    if (!item) continue;
    const appUsage = apps[index];
    item.label = appUsage
      ? `${appUsage.name} · ${formatDuration(appUsage.duration)}`
      : index === 0
        ? "No app activity yet"
        : "";
    item.visible = Boolean(appUsage) || index === 0;
  }
}

function formatDuration(seconds) {
  const minutes = Math.floor((Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function showWindow() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const iconSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="#111" d="M2 9h2v6H2zm4-5h2v11H6zm4 2h2v9h-2zm4-4h2v13h-2z"/></svg>';
  tray = new Tray(
    nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}`,
    ),
  );
  tray.setToolTip("AWScreen · ActivityWatch");
  trayMenu = Menu.buildFromTemplate([
    { label: "Open AWScreen", click: showWindow },
    {
      id: "widget-toggle",
      label: "Glance widget",
      type: "checkbox",
      checked: Boolean(activity?.settings.widgetVisible),
      click: (item) => setWidgetVisible(item.checked),
    },
    { label: "Refresh now", click: () => activity.refresh() },
    { type: "separator" },
    { label: "TOP APPS TODAY", enabled: false },
    {
      id: "top-app-0",
      label: "No app activity yet",
      enabled: false,
    },
    { id: "top-app-1", label: "", enabled: false, visible: false },
    { id: "top-app-2", label: "", enabled: false, visible: false },
    { type: "separator" },
    {
      label: "Settings",
      click: () => {
        showWindow();
        mainWindow.webContents.send("app:navigate", "settings");
      },
    },
    { type: "separator" },
    {
      label: "Quit AWScreen",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(trayMenu);
  updateTrayTopApps(activity?.state);
  tray.on("click", showWindow);
}

app.whenReady().then(async () => {
  app.setName("AWScreen");
  activity = new ActivityService({
    userDataPath: app.getPath("userData"),
    onUpdate: (state) => {
      mainWindow?.webContents.send("activity:state", state);
      widgetWindow?.webContents.send("activity:state", state);
      updateTrayTopApps(state);
    },
  });
  app.setLoginItemSettings({
    openAtLogin: activity.settings.launchAtLogin,
    args: ["--hidden"],
  });
  createWindow();
  createTray();
  ipcMain.handle("activity:get-state", () => activity.state);
  ipcMain.handle("activity:refresh", () => activity.refresh());
  ipcMain.handle("activity:save-categories", (_event, categories) =>
    activity.saveCategories(categories),
  );
  ipcMain.handle("settings:update", async (_event, updates) => {
    const settings = await activity.updateSettings(updates);
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      args: ["--hidden"],
    });
    return activity.state;
  });
  ipcMain.handle("app:open-external", (_event, url) => {
    if (typeof url === "string" && url.startsWith("http://localhost"))
      return shell.openExternal(url);
  });
  ipcMain.handle("app:open-dashboard", () => {
    showWindow();
  });
  ipcMain.handle("widget:toggle", () => {
    setWidgetVisible(!widgetWindow?.isVisible());
    return Boolean(widgetWindow?.isVisible());
  });
  ipcMain.handle("widget:set-visible", (_event, visible) => {
    setWidgetVisible(Boolean(visible));
    return Boolean(widgetWindow?.isVisible());
  });
  ipcMain.handle("app:quit", () => {
    quitting = true;
    app.quit();
  });
  activity.start();
  if (activity.settings.widgetVisible) setWidgetVisible(true, false);
  if (app.commandLine.hasSwitch("hidden")) mainWindow.hide();
  app.on("activate", showWindow);
});

app.on("before-quit", () => {
  quitting = true;
  activity.stop();
});

app.on("window-all-closed", (event) => {
  if (!isMac) app.quit();
});
