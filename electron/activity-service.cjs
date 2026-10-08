const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = {
  serverUrl: "http://localhost:5600",
  refreshInterval: 45,
  launchAtLogin: true,
  widgetVisible: false,
};

class ActivityService {
  constructor({ userDataPath, onUpdate }) {
    this.settingsPath = path.join(userDataPath, "settings.json");
    this.settings = this.readSettings();
    this.onUpdate = onUpdate;
    this.timer = null;
    this.refreshing = false;
    this.state = {
      connected: false,
      loading: false,
      error: null,
      lastUpdated: null,
      settings: this.settings,
      categories: [],
      summary: emptySummary(),
    };
  }

  readSettings() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      return { ...DEFAULT_SETTINGS, ...saved };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  publish(patch = {}) {
    this.state = { ...this.state, ...patch, settings: { ...this.settings } };
    this.onUpdate?.(this.state);
    return this.state;
  }

  start() {
    this.refresh();
    this.schedule();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.settings.refreshInterval <= 0) return;
    this.timer = setTimeout(async () => {
      await this.refresh();
      this.schedule();
    }, this.settings.refreshInterval * 1000);
  }

  async updateSettings(updates) {
    const next = { ...this.settings, ...updates };
    if (Object.hasOwn(updates, "serverUrl"))
      next.serverUrl = validateLocalUrl(updates.serverUrl);
    if (Object.hasOwn(updates, "refreshInterval")) {
      const allowed = [0, 30, 45, 60, 120];
      if (!allowed.includes(Number(updates.refreshInterval)))
        throw new Error("Choose a listed refresh interval.");
      next.refreshInterval = Number(updates.refreshInterval);
    }
    if (Object.hasOwn(updates, "launchAtLogin"))
      next.launchAtLogin = Boolean(updates.launchAtLogin);
    if (Object.hasOwn(updates, "widgetVisible"))
      next.widgetVisible = Boolean(updates.widgetVisible);
    this.settings = next;
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(next, null, 2));
    this.publish();
    if (Object.hasOwn(updates, "refreshInterval")) this.schedule();
    if (Object.hasOwn(updates, "serverUrl")) await this.refresh();
    return this.settings;
  }

  async saveCategories(categories) {
    if (!Array.isArray(categories))
      throw new Error("Category data must be a list.");
    await this.request("/api/0/settings/classes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(categories),
    });
    this.publish({ categories });
    await this.refresh();
    return this.state;
  }

  async refresh() {
    if (this.refreshing) return this.state;
    this.refreshing = true;
    this.publish({ loading: true, error: null });
    try {
      await this.request("/api/0/info");
      const [buckets, categoriesResponse] = await Promise.all([
        this.request("/api/0/buckets/"),
        this.request("/api/0/settings/classes").catch((error) => {
          if (error.status === 404) return [];
          throw error;
        }),
      ]);
      const categories = unwrapCategories(categoriesResponse);
      const bucketList = Object.entries(buckets || {}).map(([id, bucket]) => ({
        id,
        ...bucket,
      }));
      const windowBucket = bucketList.find(
        (bucket) =>
          bucket.id.toLowerCase().includes("aw-watcher-window") ||
          bucket.type === "currentwindow",
      );
      if (!windowBucket)
        throw new Error("No ActivityWatch window bucket was found.");

      const { start, end } = todayBounds();
      const [windowEvents, afkBucket] = await Promise.all([
        this.getEvents(windowBucket.id, start, end),
        Promise.resolve(
          bucketList.find(
            (bucket) =>
              bucket.id.toLowerCase().includes("aw-watcher-afk") ||
              bucket.type === "afkstatus",
          ),
        ),
      ]);
      const afkEvents = afkBucket
        ? await this.getEvents(afkBucket.id, start, end)
        : [];
      const summary = buildSummary(windowEvents, afkEvents, categories);
      this.publish({
        connected: true,
        loading: false,
        error: null,
        lastUpdated: new Date().toISOString(),
        categories,
        summary,
      });
    } catch (error) {
      this.publish({
        connected: false,
        loading: false,
        error: error.message || "ActivityWatch is unavailable.",
      });
    } finally {
      this.refreshing = false;
    }
    return this.state;
  }

  async getEvents(bucketId, start, end) {
    const query = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      limit: "-1",
    });
    return this.request(
      `/api/0/buckets/${encodeURIComponent(bucketId)}/events?${query}`,
    );
  }

  async request(endpoint, options = {}) {
    const base = validateLocalUrl(this.settings.serverUrl).replace(/\/$/, "");
    const response = await fetch(`${base}${endpoint}`, {
      ...options,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const error = new Error(
        `ActivityWatch returned HTTP ${response.status}.`,
      );
      error.status = response.status;
      throw error;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

function validateLocalUrl(value) {
  const url = new URL(String(value));
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
  ) {
    throw new Error(
      "ActivityWatch must use a local HTTP address such as http://localhost:5600.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function unwrapCategories(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.classes)) return value.classes;
  if (Array.isArray(value?.value)) return value.value;
  return [];
}

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function emptySummary() {
  return {
    total: 0,
    categorized: 0,
    categories: [],
    apps: [],
    titles: [],
    hourly: Array(24).fill(0),
    timeline: [],
  };
}

function buildSummary(windowEvents, afkEvents, categories) {
  const activeIntervals = afkEvents.filter(
    (event) => event.data?.status === "not-afk",
  );
  const awayEvents = afkEvents.filter((event) => event.data?.status === "afk");
  const slices = [];

  for (const event of windowEvents) {
    const eventStart = new Date(event.timestamp);
    const eventEnd = new Date(
      eventStart.getTime() + Math.max(0, Number(event.duration) || 0) * 1000,
    );
    const app = String(event.data?.app ?? "Unknown");
    const title = String(event.data?.title ?? "");
    const intervals = afkEvents.length
      ? activeIntervals
      : [{ timestamp: eventStart, duration: (eventEnd - eventStart) / 1000 }];
    for (const interval of intervals) {
      const intervalStart = new Date(interval.timestamp);
      const intervalEnd = new Date(
        intervalStart.getTime() +
          Math.max(0, Number(interval.duration) || 0) * 1000,
      );
      const start = new Date(
        Math.max(eventStart.getTime(), intervalStart.getTime()),
      );
      const end = new Date(Math.min(eventEnd.getTime(), intervalEnd.getTime()));
      if (end <= start) continue;
      const matched = classify(app, title, categories);
      slices.push({
        start: start.toISOString(),
        duration: (end - start) / 1000,
        app,
        title,
        category: matched?.name?.join(" › ") || "Uncategorized",
      });
    }
  }

  const categoryTotals = new Map();
  const appTotals = new Map();
  const titleTotals = new Map();
  const hourly = Array(24).fill(0);
  let categorized = 0;
  for (const slice of slices) {
    addTotal(categoryTotals, slice.category, slice.duration);
    addTotal(appTotals, slice.app, slice.duration);
    if (slice.title) addTotal(titleTotals, slice.title, slice.duration);
    if (slice.category !== "Uncategorized") categorized += slice.duration;
    distributeHourly(hourly, slice.start, slice.duration);
  }

  const timeline = [
    ...slices,
    ...awayEvents.map((event) => ({
      start: new Date(event.timestamp).toISOString(),
      duration: Math.max(0, Number(event.duration) || 0),
      app: "Away from keyboard",
      title: "",
      category: "AFK",
    })),
  ].sort((a, b) => b.start.localeCompare(a.start));

  return {
    total: slices.reduce((sum, slice) => sum + slice.duration, 0),
    categorized,
    categories: toUsageItems(categoryTotals),
    apps: toUsageItems(appTotals),
    titles: toUsageItems(titleTotals),
    hourly,
    timeline,
  };
}

function classify(app, title, categories) {
  const matches = [];
  categories.forEach((category, index) => {
    const rule = category.rule || {};
    if ((rule.type && rule.type !== "regex") || !rule.regex) return;
    let expression;
    try {
      expression = new RegExp(rule.regex, rule.ignore_case ? "i" : "");
    } catch {
      return;
    }
    const fields = rule.select_keys || ["app", "title"];
    if (
      fields.some(
        (field) =>
          (field === "app" && expression.test(app)) ||
          (field === "title" && expression.test(title)),
      )
    ) {
      matches.push({ category, index, depth: (category.name || []).length });
    }
  });
  matches.sort((a, b) => b.depth - a.depth || a.index - b.index);
  return matches[0]?.category ?? null;
}

function distributeHourly(totals, startValue, duration) {
  const end = new Date(new Date(startValue).getTime() + duration * 1000);
  let cursor = new Date(startValue);
  while (cursor < end) {
    const nextHour = new Date(cursor);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const segmentEnd = new Date(Math.min(end.getTime(), nextHour.getTime()));
    totals[cursor.getHours()] += (segmentEnd - cursor) / 1000;
    cursor = segmentEnd;
  }
}

function addTotal(map, key, duration) {
  map.set(key, (map.get(key) || 0) + duration);
}

function toUsageItems(map) {
  return [...map]
    .map(([name, duration]) => ({ name, duration }))
    .sort((a, b) => b.duration - a.duration);
}

module.exports = { ActivityService, buildSummary, classify, validateLocalUrl };
