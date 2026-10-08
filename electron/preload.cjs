const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("awScreen", {
  getState: () => ipcRenderer.invoke("activity:get-state"),
  refresh: () => ipcRenderer.invoke("activity:refresh"),
  saveCategories: (categories) =>
    ipcRenderer.invoke("activity:save-categories", categories),
  updateSettings: (settings) => ipcRenderer.invoke("settings:update", settings),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  openDashboard: () => ipcRenderer.invoke("app:open-dashboard"),
  toggleWidget: () => ipcRenderer.invoke("widget:toggle"),
  setWidgetVisible: (visible) =>
    ipcRenderer.invoke("widget:set-visible", visible),
  quit: () => ipcRenderer.invoke("app:quit"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("activity:state", listener);
    return () => ipcRenderer.removeListener("activity:state", listener);
  },
  onNavigate: (callback) => {
    const listener = (_event, route) => callback(route);
    ipcRenderer.on("app:navigate", listener);
    return () => ipcRenderer.removeListener("app:navigate", listener);
  },
  onWidgetVisibility: (callback) => {
    const listener = (_event, visible) => callback(visible);
    ipcRenderer.on("widget:visibility", listener);
    return () => ipcRenderer.removeListener("widget:visibility", listener);
  },
});
