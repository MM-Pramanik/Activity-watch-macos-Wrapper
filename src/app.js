const state = {
  connected: false,
  loading: true,
  error: null,
  lastUpdated: null,
  settings: {
    serverUrl: "http://localhost:5600",
    refreshInterval: 45,
    launchAtLogin: true,
  },
  categories: [],
  summary: {
    total: 0,
    categorized: 0,
    categories: [],
    apps: [],
    titles: [],
    hourly: Array(24).fill(0),
    timeline: [],
  },
};

let route = "today";
let selectedApp = null;
let selectedTitle = null;
let selectedCategoryId = null;
let toastTimer;
const page = document.querySelector("#page");
const toast = document.querySelector("#toast");

document.querySelectorAll("[data-route]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.route));
});
document.querySelector("#refresh-button").addEventListener("click", refresh);
document
  .querySelector("#widget-toggle")
  .addEventListener("click", async () => window.awScreen.toggleWidget());
document
  .querySelector("#quit-button")
  .addEventListener("click", () => window.awScreen.quit());
window.awScreen.onState(updateState);
window.awScreen.onNavigate(navigate);
window.awScreen.onWidgetVisibility(updateWidgetToggle);
window.awScreen.getState().then(updateState);

function updateState(next) {
  Object.assign(state, next);
  document.querySelector("#toolbar-status").textContent = state.connected
    ? "Connected · localhost"
    : "ActivityWatch offline";
  document.querySelector("#sidebar-status").textContent = state.connected
    ? "Connected to ActivityWatch"
    : state.loading
      ? "Connecting to ActivityWatch"
      : "ActivityWatch unavailable";
  document
    .querySelector("#sidebar-status-dot")
    .classList.toggle("online", state.connected);
  document.querySelector("#updated-label").textContent = state.lastUpdated
    ? `Updated ${relativeTime(state.lastUpdated)}`
    : "";
  document
    .querySelector("#refresh-button")
    .classList.toggle("spinning", state.loading);
  updateWidgetToggle(Boolean(state.settings?.widgetVisible));
  render();
}

function updateWidgetToggle(visible) {
  const button = document.querySelector("#widget-toggle");
  button.classList.toggle("active", visible);
  button.title = visible ? "Hide glance widget" : "Show glance widget";
  button.setAttribute("aria-label", button.title);
}

function navigate(nextRoute) {
  route = nextRoute;
  document
    .querySelectorAll("[data-route]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.route === route),
    );
  render();
}

function render() {
  const views = {
    today: renderToday,
    timeline: renderTimeline,
    applications: renderApplications,
    websites: renderWebsites,
    categories: renderCategories,
    settings: renderSettings,
  };
  page.innerHTML = (views[route] || renderToday)();
  bindPageEvents();
}

function renderToday() {
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const summary = state.summary;
  if (state.loading && !summary.total)
    return (
      pageHeader("Today", date) +
      emptyState(
        "Connecting to ActivityWatch",
        "Reading today’s local activity…",
        "◌",
        false,
      )
    );
  if (!state.connected && !summary.total)
    return (
      pageHeader("Today", date) +
      emptyState(
        "ActivityWatch is unavailable",
        state.error ||
          "Make sure ActivityWatch is running, then retry the connection.",
        "⌁",
        true,
      )
    );
  if (!summary.total)
    return (
      pageHeader("Today", date) +
      emptyState(
        "No activity yet",
        "ActivityWatch has not recorded active window use today. AWScreen does not track activity itself.",
        "◷",
        true,
      )
    );

  return `${pageHeader("Today", date)}
    <div class="today-hero"><div><div class="hero-total">${formatDuration(summary.total)}</div><div class="hero-caption">tracked active time</div></div><div class="hero-side"><strong>${formatDuration(summary.categorized)} categorized</strong><span>${percent(summary.categorized, summary.total)} of tracked time</span></div></div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-heading"><h2>Activity</h2><span class="panel-note">Tracked time by hour</span></div>${renderChart(summary.hourly)}</section>
      <section class="panel category-panel"><div class="panel-heading"><h2>Categories</h2><button class="text-action" data-navigate="categories">Edit rules</button></div>${renderUsageList(summary.categories, summary.total, 8)}</section>
    </div>
    <div class="below-grid">
      <section class="panel"><div class="panel-heading"><h2>Top applications</h2><button class="text-action" data-navigate="applications">See all</button></div>${renderRankList(summary.apps.slice(0, 6))}</section>
      <section class="panel"><div class="panel-heading"><h2>Recent activity</h2><button class="text-action" data-navigate="timeline">Open timeline</button></div>${renderTimelineRows(summary.timeline.slice(0, 5))}</section>
    </div>`;
}

function renderChart(hours) {
  const values = hours || Array(24).fill(0);
  const max = Math.max(...values, 60);
  const bars = values
    .map((seconds, hour) => {
      const height = seconds ? Math.max(4, (seconds / max) * 100) : 0;
      return `<div class="bar-column" title="${hourLabel(hour)} · ${formatDuration(seconds)}"><div class="bar" style="height:${height}%"></div></div>`;
    })
    .join("");
  return `<div class="chart-wrap"><div class="chart-y"><span>${formatDuration(max)}</span><span>${formatDuration(max / 2)}</span><span>0</span></div><div style="flex:1;min-width:0"><div class="chart-bars">${bars}</div><div class="hour-labels"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div></div></div>`;
}

function renderTimeline() {
  const items = state.summary.timeline;
  return `${pageHeader("Timeline", "A human-readable history from ActivityWatch window and AFK events.")}
    ${items.length ? `<section class="panel"><div class="panel-heading"><h2>Today</h2><span class="panel-note">${items.length} events</span></div><div class="timeline">${renderTimelineRows(items.slice(0, 250))}</div></section>` : emptyState("No timeline activity", "There are no ActivityWatch events to show for today.", "≋", true)}`;
}

function renderApplications() {
  const apps = state.summary.apps;
  if (!apps.length)
    return `${pageHeader("Applications", "Time grouped by the application name reported by ActivityWatch.")}${emptyState("No application data", "Application totals will appear after ActivityWatch records active windows.", "▣", true)}`;
  if (!selectedApp || !apps.some((app) => app.name === selectedApp))
    selectedApp = apps[0].name;
  const selected = apps.find((app) => app.name === selectedApp);
  const slices = state.summary.timeline.filter(
    (slice) => slice.app === selectedApp,
  );
  const categories = groupSlices(slices, "category");
  const titles = groupSlices(slices, "title").filter((item) => item.name);
  return `${pageHeader("Applications", "Today · Select an app to inspect its activity.")}
    <div class="split-view"><section class="panel list-panel">${apps.map((app) => `<button class="select-row ${app.name === selectedApp ? "selected" : ""}" data-app="${attr(app.name)}"><span class="select-name">${escapeHTML(app.name)}</span><span class="usage-time">${formatDuration(app.duration)}</span></button>`).join("")}</section>
    <section class="panel detail-panel"><h2>${escapeHTML(selected.name)}</h2><div class="detail-total">${formatDuration(selected.duration)} today</div>
      <div class="detail-section"><h3 class="section-title">Categories</h3>${renderRankList(categories)}</div>
      <div class="detail-section"><h3 class="section-title">Top activity</h3>${titles.length ? renderRankList(titles.slice(0, 12)) : '<p class="subtitle">No window titles were recorded for this app.</p>'}</div>
    </section></div>`;
}

function renderWebsites() {
  const titles = state.summary.titles;
  if (!titles.length)
    return `${pageHeader("Websites & titles", "Window titles reported by ActivityWatch. No browser extension or additional tracking.")}${emptyState("No window titles recorded", "ActivityWatch has not reported window titles for today.", "◎", true)}`;
  if (!selectedTitle || !titles.some((item) => item.name === selectedTitle))
    selectedTitle = titles[0].name;
  const selected = titles.find((item) => item.name === selectedTitle);
  const related = state.summary.timeline.filter(
    (slice) => slice.title === selectedTitle,
  );
  return `${pageHeader("Websites & titles", "ActivityWatch window titles · Today")}
    <div class="split-view"><section class="panel list-panel">${titles.map((item) => `<button class="select-row ${item.name === selectedTitle ? "selected" : ""}" data-title="${attr(item.name)}"><span class="select-name">${escapeHTML(item.name)}</span><span class="usage-time">${formatDuration(item.duration)}</span></button>`).join("")}</section>
    <section class="panel detail-panel"><h2>${escapeHTML(selected.name)}</h2><div class="detail-total">${formatDuration(selected.duration)} today</div><div class="detail-section"><h3 class="section-title">Applications</h3>${renderRankList(groupSlices(related, "app"))}</div></section></div>`;
}

function renderCategories() {
  const categories = state.categories || [];
  if (
    selectedCategoryId == null ||
    !categories.some((item) => String(item.id) === String(selectedCategoryId))
  )
    selectedCategoryId = categories[0]?.id ?? null;
  const selected = categories.find(
    (item) => String(item.id) === String(selectedCategoryId),
  );
  return `${pageHeader("Categories", "Rules are read from and saved to ActivityWatch’s native classes setting.")}
    <div class="split-view"><section class="panel list-panel"><div class="editor-toolbar"><h2 class="section-title">Rules</h2><button class="icon-button" data-action="new-category" title="Add category" aria-label="Add category">+</button></div>
      ${categories.length ? categories.map((item) => `<button class="select-row ${String(item.id) === String(selectedCategoryId) ? "selected" : ""}" data-category="${attr(item.id)}"><span class="select-name">${escapeHTML((item.name || []).join(" › ") || "Unnamed category")}</span><span class="usage-time">${item.rule?.type === "regex" ? "Regex" : escapeHTML(item.rule?.type || "Rule")}</span></button>`).join("") : '<p class="subtitle">No category rules found in ActivityWatch.</p>'}</section>
      ${selected ? renderCategoryEditor(selected) : '<section class="panel empty-state"><h2>Create a rule</h2><p>Add a hierarchical ActivityWatch category and configure its matching rule.</p></section>'}</div>`;
}

function renderCategoryEditor(category) {
  const rule = category.rule || {};
  const keys = rule.select_keys || ["app", "title"];
  return `<section class="panel detail-panel"><div class="editor-toolbar"><h2 class="section-title">Rule editor</h2><button class="danger-button" data-action="delete-category">Delete</button></div>
    <div class="category-editor"><div class="field"><label for="category-name">CATEGORY PATH</label><input class="text-input" id="category-name" value="${attr((category.name || []).join(" / "))}" placeholder="Work / Programming"></div>
      <div class="field"><label for="category-regex">REGULAR EXPRESSION</label><textarea class="text-input" id="category-regex" placeholder="(?i)github|stackoverflow">${escapeHTML(rule.regex || "")}</textarea></div>
      <label class="checkbox-row"><span class="field-label">MATCH AGAINST</span></label><div class="checkbox-row"><label><input type="checkbox" id="match-app" ${keys.includes("app") ? "checked" : ""}> App</label><label><input type="checkbox" id="match-title" ${keys.includes("title") ? "checked" : ""}> Title</label><label><input type="checkbox" id="ignore-case" ${rule.ignore_case ? "checked" : ""}> Ignore case</label></div>
      <div class="field"><label for="test-app">TEST APP</label><input class="text-input" id="test-app" value="Google Chrome"></div>
      <div class="field"><label for="test-title">TEST TITLE</label><input class="text-input" id="test-title" value="GitHub - ActivityWatch"></div>
      <div class="inline-actions"><button class="secondary-button" data-action="test-rule">Test rule</button><button class="primary-button" data-action="save-category">Save to ActivityWatch</button></div>
      <div id="test-result"></div><div id="category-error" class="error-text"></div>
    </div></section>`;
}

function renderSettings() {
  const settings = state.settings;
  const intervalOptions = [
    [0, "Manual"],
    [30, "30 seconds"],
    [45, "45 seconds"],
    [60, "1 minute"],
    [120, "2 minutes"],
  ];
  return `${pageHeader("Settings", "AWScreen only reads your local ActivityWatch instance.")}
    <div class="settings-layout"><section class="settings-section"><h2>Background</h2><p class="settings-description">Keep AWScreen available from the macOS menu bar while activity refreshes in the background.</p>
      <div class="setting-line"><div><strong>Launch at login</strong><small>Start AWScreen when you sign in</small></div><input class="switch" type="checkbox" id="launch-login" ${settings.launchAtLogin ? "checked" : ""}></div>
      <div class="field"><label for="refresh-interval">REFRESH INTERVAL</label><select class="select-input" id="refresh-interval">${intervalOptions.map(([value, label]) => `<option value="${value}" ${Number(settings.refreshInterval) === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
    </section>
    <section class="settings-section"><h2>ActivityWatch</h2><p class="settings-description">Connect only to a loopback address. No activity is sent to AWScreen servers.</p>
      <div class="field"><label for="server-url">LOCAL SERVER URL</label><input class="text-input" id="server-url" value="${attr(settings.serverUrl)}" spellcheck="false"></div>
      <div class="inline-actions"><button class="primary-button" data-action="test-connection">Test connection</button><button class="secondary-button" data-action="open-api">Open API</button></div>
      <div id="connection-result" class="${state.connected ? "test-result" : "error-text"}" style="margin-top:12px">${state.connected ? "Connected to ActivityWatch" : escapeHTML(state.error || "Not connected")}</div>
    </section>
    <section class="settings-section"><h2>Privacy</h2><p class="settings-description">ActivityWatch remains the source of recorded activity. AWScreen does not install a browser tracker, add its own activity collector, or upload browsing history.</p></section></div>`;
}

function renderTimelineRows(items) {
  if (!items.length) return '<p class="subtitle">No events yet.</p>';
  return items
    .map((item) => {
      const away = item.category === "AFK";
      return `<div class="timeline-row ${away ? "afk" : ""}"><time class="timeline-time">${escapeHTML(timeLabel(item.start))}</time><div class="timeline-rail"><i class="timeline-dot"></i></div><div class="timeline-main"><strong>${escapeHTML(item.app)}</strong>${item.title ? `<span>${escapeHTML(item.title)}</span>` : ""}<span class="timeline-category">${escapeHTML(item.category)}</span></div><span class="timeline-duration">${formatDuration(item.duration)}</span></div>`;
    })
    .join("");
}

function renderUsageList(items, total, limit = 8) {
  if (!items?.length)
    return '<p class="subtitle">No category data yet. Configure rules in Categories.</p>';
  return `<div class="category-list">${items
    .slice(0, limit)
    .map(
      (item) =>
        `<div class="usage-row"><span class="usage-name" title="${attr(item.name)}">${escapeHTML(item.name)}</span><span class="usage-time">${formatDuration(item.duration)}</span><div class="usage-track"><div class="usage-fill" style="width:${Math.min(100, total ? (item.duration / total) * 100 : 0)}%"></div></div></div>`,
    )
    .join("")}</div>`;
}

function renderRankList(items) {
  if (!items?.length) return '<p class="subtitle">No activity data yet.</p>';
  return `<div class="rank-list">${items.map((item, index) => `<div class="rank-row"><span class="rank-number">${String(index + 1).padStart(2, "0")}</span><span class="rank-name" title="${attr(item.name)}">${escapeHTML(item.name)}</span><span class="rank-duration">${formatDuration(item.duration)}</span></div>`).join("")}</div>`;
}

function pageHeader(title, subtitle) {
  return `<header class="page-heading"><div><p class="eyebrow">AWScreen · ActivityWatch</p><h1>${escapeHTML(title)}</h1><p class="subtitle">${escapeHTML(subtitle)}</p></div></header>`;
}

function emptyState(title, message, symbol, retry) {
  return `<section class="panel empty-state"><div class="empty-symbol">${symbol}</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p>${retry ? '<button class="primary-button" data-action="retry">Retry</button>' : ""}</section>`;
}

function bindPageEvents() {
  page
    .querySelectorAll("[data-navigate]")
    .forEach((button) =>
      button.addEventListener("click", () => navigate(button.dataset.navigate)),
    );
  page.querySelectorAll("[data-app]").forEach((button) =>
    button.addEventListener("click", () => {
      selectedApp = button.dataset.app;
      render();
    }),
  );
  page.querySelectorAll("[data-title]").forEach((button) =>
    button.addEventListener("click", () => {
      selectedTitle = button.dataset.title;
      render();
    }),
  );
  page.querySelectorAll("[data-category]").forEach((button) =>
    button.addEventListener("click", () => {
      selectedCategoryId = button.dataset.category;
      render();
    }),
  );
  page
    .querySelectorAll("[data-action]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        handleAction(button.dataset.action),
      ),
    );
}

async function handleAction(action) {
  try {
    if (action === "retry") await refresh();
    if (action === "new-category") createCategory();
    if (action === "test-rule") testRule();
    if (action === "save-category") await saveCategory();
    if (action === "delete-category") await deleteCategory();
    if (action === "test-connection") await testConnection();
    if (action === "open-api")
      await window.awScreen.openExternal(`${state.settings.serverUrl}/api/`);
  } catch (error) {
    showToast(error.message || "Something went wrong.");
  }
}

async function refresh() {
  document.querySelector("#refresh-button").classList.add("spinning");
  updateState(await window.awScreen.refresh());
}

function createCategory() {
  const nextId =
    Math.max(
      0,
      ...state.categories.map((category) => Number(category.id) || 0),
    ) + 1;
  state.categories = [
    ...state.categories,
    {
      id: nextId,
      name: ["New category"],
      rule: {
        type: "regex",
        regex: "",
        ignore_case: false,
        select_keys: ["app", "title"],
      },
      data: {},
    },
  ];
  selectedCategoryId = nextId;
  render();
}

function readCategoryDraft() {
  const original = state.categories.find(
    (category) => String(category.id) === String(selectedCategoryId),
  );
  if (!original) throw new Error("Choose a category first.");
  const name = document
    .querySelector("#category-name")
    .value.split(/[›/]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!name.length) throw new Error("Enter a category path.");
  const keys = [];
  if (document.querySelector("#match-app").checked) keys.push("app");
  if (document.querySelector("#match-title").checked) keys.push("title");
  if (!keys.length)
    throw new Error("Select App, Title, or both as a match field.");
  return {
    ...original,
    name,
    rule: {
      type: "regex",
      regex: document.querySelector("#category-regex").value,
      ignore_case: document.querySelector("#ignore-case").checked,
      select_keys: keys,
    },
  };
}

function testRule() {
  const category = readCategoryDraft();
  let regex;
  try {
    regex = new RegExp(
      category.rule.regex,
      category.rule.ignore_case ? "i" : "",
    );
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error.message}`);
  }
  const app = document.querySelector("#test-app").value;
  const title = document.querySelector("#test-title").value;
  const matchedField = category.rule.select_keys.find((field) =>
    regex.test(field === "app" ? app : title),
  );
  const result = document.querySelector("#test-result");
  result.className = `test-result ${matchedField ? "" : "no-match"}`;
  result.textContent = matchedField
    ? `MATCH · ${matchedField === "app" ? "App" : "Title"}`
    : "NO MATCH";
}

async function saveCategory() {
  const draft = readCategoryDraft();
  const categories = state.categories.map((category) =>
    String(category.id) === String(selectedCategoryId) ? draft : category,
  );
  const next = await window.awScreen.saveCategories(categories);
  updateState(next);
  selectedCategoryId = draft.id;
  showToast("Category rules saved to ActivityWatch.");
}

async function deleteCategory() {
  const categories = state.categories.filter(
    (category) => String(category.id) !== String(selectedCategoryId),
  );
  const next = await window.awScreen.saveCategories(categories);
  selectedCategoryId = null;
  updateState(next);
  showToast("Category removed from ActivityWatch.");
}

async function testConnection() {
  const url = document.querySelector("#server-url").value.trim();
  const next = await window.awScreen.updateSettings({ serverUrl: url });
  updateState(next);
  showToast(
    next.connected
      ? "Connected to ActivityWatch."
      : next.error || "ActivityWatch is offline.",
  );
}

page.addEventListener("change", async (event) => {
  if (event.target.id === "refresh-interval") {
    updateState(
      await window.awScreen.updateSettings({
        refreshInterval: Number(event.target.value),
      }),
    );
    showToast("Refresh interval updated.");
  }
  if (event.target.id === "launch-login") {
    updateState(
      await window.awScreen.updateSettings({
        launchAtLogin: event.target.checked,
      }),
    );
    showToast(
      event.target.checked
        ? "Launch at login enabled."
        : "Launch at login disabled.",
    );
  }
});

function groupSlices(slices, key) {
  const totals = new Map();
  slices.forEach((slice) =>
    totals.set(slice[key], (totals.get(slice[key]) || 0) + slice.duration),
  );
  return [...totals]
    .map(([name, duration]) => ({ name, duration }))
    .sort((a, b) => b.duration - a.duration);
}

function formatDuration(seconds) {
  const minutes = Math.floor((Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
}

function percent(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "0%";
}
function hourLabel(hour) {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });
}
function timeLabel(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
function relativeTime(value) {
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    -Math.round((Date.now() - new Date(value).getTime()) / 60000),
    "minute",
  );
}
function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
function attr(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}
