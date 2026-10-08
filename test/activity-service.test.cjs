const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ActivityService,
  buildSummary,
  classify,
  validateLocalUrl,
} = require("../electron/activity-service.cjs");

test("App and Title matching remain independent", () => {
  const titleOnly = [
    {
      name: ["Entertainment", "YouTube"],
      rule: { regex: "youtube", ignore_case: true, select_keys: ["title"] },
    },
  ];
  assert.equal(
    classify("Google Chrome", "YouTube - Example", titleOnly),
    titleOnly[0],
  );
  assert.equal(
    classify("Google Chrome", "DaVinci Resolve Tutorial", [
      { ...titleOnly[0], rule: { ...titleOnly[0].rule, select_keys: ["app"] } },
    ]),
    null,
  );
});

test("deepest matching category wins and source order breaks ties", () => {
  const categories = [
    {
      name: ["Work"],
      rule: { regex: "code", ignore_case: true, select_keys: ["app"] },
    },
    {
      name: ["Study"],
      rule: { regex: "code", ignore_case: true, select_keys: ["app"] },
    },
    {
      name: ["Work", "Programming"],
      rule: { regex: "code", ignore_case: true, select_keys: ["app"] },
    },
  ];
  assert.equal(classify("Code Editor", "", categories), categories[2]);
});

test("activity is clipped to active intervals and AFK is shown without being counted", () => {
  const windowEvents = [
    {
      timestamp: "2026-10-08T10:00:00.000Z",
      duration: 3600,
      data: { app: "Editor", title: "Project" },
    },
  ];
  const afkEvents = [
    {
      timestamp: "2026-10-08T10:00:00.000Z",
      duration: 1800,
      data: { status: "not-afk" },
    },
    {
      timestamp: "2026-10-08T10:30:00.000Z",
      duration: 600,
      data: { status: "afk" },
    },
  ];
  const summary = buildSummary(windowEvents, afkEvents, []);
  assert.equal(summary.total, 1800);
  assert.equal(summary.timeline.length, 2);
  assert.ok(summary.timeline.some((item) => item.category === "AFK"));
});

test("an AFK-only day does not fall back to counting window events", () => {
  const summary = buildSummary(
    [
      {
        timestamp: "2026-10-08T10:00:00.000Z",
        duration: 1200,
        data: { app: "Editor" },
      },
    ],
    [
      {
        timestamp: "2026-10-08T10:00:00.000Z",
        duration: 1200,
        data: { status: "afk" },
      },
    ],
    [],
  );
  assert.equal(summary.total, 0);
  assert.equal(summary.timeline.length, 1);
});

test("hourly aggregation splits an event across the hour boundary", () => {
  const summary = buildSummary(
    [
      {
        timestamp: "2026-10-08T10:59:00.000Z",
        duration: 120,
        data: { app: "Editor" },
      },
    ],
    [],
    [],
  );
  const firstHour = new Date("2026-10-08T10:59:00.000Z").getHours();
  assert.equal(summary.hourly[firstHour], 60);
  assert.equal(summary.hourly[(firstHour + 1) % 24], 60);
});

test("top apps rank usage across all categories", () => {
  const summary = buildSummary(
    [
      {
        timestamp: "2026-10-08T10:00:00.000Z",
        duration: 600,
        data: { app: "Code Editor", title: "Project" },
      },
      {
        timestamp: "2026-10-08T10:10:00.000Z",
        duration: 300,
        data: { app: "Browser", title: "Docs" },
      },
    ],
    [],
    [
      {
        name: ["Work", "Programming"],
        rule: { regex: "code editor", ignore_case: true, select_keys: ["app"] },
      },
      {
        name: ["Study"],
        rule: { regex: "browser", ignore_case: true, select_keys: ["app"] },
      },
    ],
  );

  assert.deepEqual(summary.apps, [
    { name: "Code Editor", duration: 600 },
    { name: "Browser", duration: 300 },
  ]);
});

test("ActivityWatch URL must be loopback HTTP", () => {
  assert.equal(
    validateLocalUrl("http://localhost:5600"),
    "http://localhost:5600",
  );
  assert.throws(() => validateLocalUrl("https://localhost:5600"));
  assert.throws(() => validateLocalUrl("http://example.com"));
});

test("widget visibility preference persists across service instances", async () => {
  const userDataPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "awscreen-widget-"),
  );
  try {
    const firstLaunch = new ActivityService({ userDataPath });
    assert.equal(firstLaunch.settings.widgetVisible, false);
    await firstLaunch.updateSettings({ widgetVisible: true });

    const nextLaunch = new ActivityService({ userDataPath });
    assert.equal(nextLaunch.settings.widgetVisible, true);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
