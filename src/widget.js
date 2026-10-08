const totalElement = document.querySelector("#widget-total");
const categoriesElement = document.querySelector("#widget-categories");
const appsElement = document.querySelector("#widget-apps");
const emptyElement = document.querySelector("#widget-empty");
const appsEmptyElement = document.querySelector("#widget-app-empty");
const statusText = document.querySelector("#widget-status-text");
const statusDot = document.querySelector("#widget-status-dot");
const dateElement = document.querySelector("#widget-date");
const updatedElement = document.querySelector("#widget-updated");

dateElement.textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
}).format(new Date());

window.awScreen.onState(renderWidget);
window.awScreen.getState().then(renderWidget);
document
  .querySelector("#widget-refresh")
  .addEventListener("click", async () => {
    await window.awScreen.refresh();
  });
document.querySelector("#widget-hide").addEventListener("click", () => {
  window.awScreen.setWidgetVisible(false);
});
document
  .querySelector("#widget-open-dashboard")
  .addEventListener("click", () => window.awScreen.openDashboard());

function renderWidget(state) {
  const summary = state.summary || {};
  const categories = summary.categories || [];
  const apps = summary.apps || [];
  const total = Number(summary.total) || 0;
  const max = Math.max(
    ...categories.map((item) => Number(item.duration) || 0),
    1,
  );

  totalElement.textContent = total ? formatDuration(total) : "0m";
  statusText.textContent = state.connected
    ? "ActivityWatch connected"
    : state.loading
      ? "Connecting to ActivityWatch"
      : "ActivityWatch offline";
  statusDot.classList.toggle("online", Boolean(state.connected));
  emptyElement.hidden = total > 0;
  categoriesElement.innerHTML = categories
    .slice(0, 4)
    .map(
      (item) => `<div class="widget-category">
        <span class="widget-category-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
        <span class="widget-category-time">${formatDuration(item.duration)}</span>
        <div class="widget-category-track"><div class="widget-category-fill" style="width:${Math.min(100, (item.duration / max) * 100)}%"></div></div>
      </div>`,
    )
    .join("");
  const maxAppDuration = Math.max(
    ...apps.map((item) => Number(item.duration) || 0),
    1,
  );
  appsElement.innerHTML = apps
    .slice(0, 3)
    .map(
      (item) => `<div class="widget-category">
        <span class="widget-category-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
        <span class="widget-category-time">${formatDuration(item.duration)}</span>
        <div class="widget-category-track"><div class="widget-app-fill" style="width:${Math.min(100, (item.duration / maxAppDuration) * 100)}%"></div></div>
      </div>`,
    )
    .join("");
  appsEmptyElement.hidden = apps.length > 0;
  document.querySelector("#widget-category-count").textContent =
    categories.length ? `${categories.length} total` : "";
  updatedElement.textContent = state.lastUpdated
    ? `Updated ${relativeTime(state.lastUpdated)}`
    : "";
}

function formatDuration(seconds) {
  const minutes = Math.floor((Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function relativeTime(value) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60000),
  );
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    -minutes,
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
