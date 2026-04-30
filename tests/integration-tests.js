// Promptly — Tier 1 integration tests for message-flow logic
// Mocks browser.storage.local with an in-memory Map and exercises addToBacklog/remove/clear/delete/save flows.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = path.resolve(__dirname, "..");

let storageBackend;
let badgeText = "";
let quotaExceeded = false;

function makeBrowser() {
  const noopListener = { addListener: () => {}, removeListener: () => {} };
  return {
    runtime: {
      getPlatformInfo: () => Promise.resolve({ os: "win" }),
      getURL: (p) => "moz-extension://test/" + p,
      sendMessage: () => Promise.resolve({}),
      openOptionsPage: () => {},
      onMessage: noopListener,
      onInstalled: noopListener,
      onStartup: noopListener,
      id: "test@ext"
    },
    storage: {
      local: {
        get: (keys) => {
          const result = {};
          if (typeof keys === "string") {
            if (storageBackend.has(keys)) result[keys] = JSON.parse(JSON.stringify(storageBackend.get(keys)));
          } else if (Array.isArray(keys)) {
            for (const k of keys) {
              if (storageBackend.has(k)) result[k] = JSON.parse(JSON.stringify(storageBackend.get(k)));
            }
          } else if (keys === null || keys === undefined) {
            for (const [k, v] of storageBackend.entries()) result[k] = JSON.parse(JSON.stringify(v));
          }
          return Promise.resolve(result);
        },
        set: (obj) => {
          if (quotaExceeded) {
            return Promise.reject(new Error("QuotaExceededError: storage full"));
          }
          for (const [k, v] of Object.entries(obj)) storageBackend.set(k, JSON.parse(JSON.stringify(v)));
          return Promise.resolve();
        }
      },
      onChanged: noopListener
    },
    tabs: {
      create: () => Promise.resolve({ id: 1 }),
      sendMessage: () => Promise.resolve(),
      onUpdated: noopListener,
      onRemoved: noopListener
    },
    contextMenus: {
      create: () => {},
      removeAll: () => Promise.resolve(),
      onClicked: noopListener
    },
    notifications: { create: () => {} },
    browserAction: {
      setBadgeText: ({ text }) => { badgeText = text; return Promise.resolve(); },
      setBadgeBackgroundColor: () => Promise.resolve()
    }
  };
}

function loadScript(file, sandbox) {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInNewContext(code, sandbox, { filename: file });
}

let pass = 0, fail = 0;
const failures = [];
async function test(name, fn) {
  try {
    storageBackend = new Map();
    badgeText = "";
    quotaExceeded = false;
    await fn();
    pass++;
    console.log("  PASS  " + name);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log("  FAIL  " + name + "  --  " + e.message);
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg || "eq") + ": expected " + e + ", got " + a);
}
function truthy(v, msg) {
  if (!v) throw new Error((msg || "truthy") + ": got " + JSON.stringify(v));
}
function falsy(v, msg) {
  if (v) throw new Error((msg || "falsy") + ": got " + JSON.stringify(v));
}

const bg = {
  browser: makeBrowser(), console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, URL, Set, Map, JSON, Date, Object, Array, Boolean, Number, String, RegExp, Math, Symbol, Error
};
bg.globalThis = bg;
bg.global = bg;
loadScript("scripts/background.js", bg);

function seedButtons(buttons) {
  storageBackend.set("buttons", buttons);
}
function getBacklogs() {
  return storageBackend.get("backlogs") || {};
}

(async () => {
  console.log("\n=== addToBacklog ===");

  await test("rejects empty buttonId", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const r = await bg.addToBacklog("", [{content:"https://x.com",type:"url",addedAt:1}]);
    falsy(r.ok);
  });

  await test("rejects unknown buttonId", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const r = await bg.addToBacklog("nope", [{content:"https://x.com",type:"url",addedAt:1}]);
    falsy(r.ok);
  });

  await test("adds single URL", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const r = await bg.addToBacklog("a", [{content:"https://x.com",type:"url",addedAt:1}]);
    truthy(r.ok); eq(r.added, 1); eq(r.total, 1);
    eq(getBacklogs().a.length, 1);
    eq(getBacklogs().a[0].content, "https://x.com/");
  });

  await test("URL is normalized on insert", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    await bg.addToBacklog("a", [{content:"HTTPS://Example.COM/page#hash",type:"url",addedAt:1}]);
    eq(getBacklogs().a[0].content, "https://example.com/page");
  });

  await test("dedupes within a single call", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const r = await bg.addToBacklog("a", [
      {content:"https://x.com",type:"url",addedAt:1},
      {content:"https://x.com/",type:"url",addedAt:2}
    ]);
    eq(r.added, 1); eq(r.skippedDupes, 1);
    eq(getBacklogs().a.length, 1);
  });

  await test("dedupes across calls", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    await bg.addToBacklog("a", [{content:"https://x.com",type:"url",addedAt:1}]);
    const r = await bg.addToBacklog("a", [{content:"https://x.com",type:"url",addedAt:2}]);
    eq(r.added, 0); eq(r.skippedDupes, 1);
    eq(getBacklogs().a.length, 1);
  });

  await test("rejects non-http URL items silently", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const r = await bg.addToBacklog("a", [
      {content:"javascript:alert(1)",type:"url",addedAt:1},
      {content:"file:///etc/passwd",type:"url",addedAt:2},
      {content:"https://ok.com",type:"url",addedAt:3}
    ]);
    eq(r.added, 1);
    eq(getBacklogs().a.length, 1);
    eq(getBacklogs().a[0].content, "https://ok.com/");
  });

  await test("selection items not normalized", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"selection",promptTemplate:"x"}]);
    const r = await bg.addToBacklog("a", [{content:"some random text",type:"selection",addedAt:1}]);
    truthy(r.ok); eq(r.added, 1);
    eq(getBacklogs().a[0].content, "some random text");
    eq(getBacklogs().a[0].type, "selection");
  });

  await test("invalid item shapes silently dropped", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const r = await bg.addToBacklog("a", [
      null, undefined, "string", 42,
      {content:42,type:"url",addedAt:1},
      {content:"x",type:"bogus",addedAt:1},
      {content:"x",type:"url"},
      {content:"https://ok.com",type:"url",addedAt:2}
    ]);
    eq(r.added, 1);
  });

  await test("quota error returns ok:false with QUOTA code", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    quotaExceeded = true;
    const r = await bg.addToBacklog("a", [{content:"https://x.com",type:"url",addedAt:1}]);
    falsy(r.ok);
    eq(r.code, "QUOTA");
  });

  console.log("\n=== removeBacklogItems ===");

  await test("removes specific items by content", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    storageBackend.set("backlogs", { a: [
      {content:"https://x.com/",type:"url",addedAt:1},
      {content:"https://y.com/",type:"url",addedAt:2},
      {content:"https://z.com/",type:"url",addedAt:3}
    ]});
    const r = await bg.removeBacklogItems("a", ["https://y.com/"]);
    truthy(r.ok); eq(r.removed, 1); eq(r.total, 2);
    const remaining = getBacklogs().a.map(it => it.content);
    eq(remaining, ["https://x.com/", "https://z.com/"]);
  });

  await test("removing all items deletes backlog key", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    storageBackend.set("backlogs", { a: [{content:"https://x.com/",type:"url",addedAt:1}] });
    const r = await bg.removeBacklogItems("a", ["https://x.com/"]);
    truthy(r.ok); eq(r.total, 0);
    eq(getBacklogs().a, undefined);
  });

  await test("removing non-existent content is a no-op", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    storageBackend.set("backlogs", { a: [{content:"https://x.com/",type:"url",addedAt:1}] });
    const r = await bg.removeBacklogItems("a", ["https://nope.com/"]);
    truthy(r.ok); eq(r.removed, 0); eq(r.total, 1);
  });

  console.log("\n=== clearBacklog ===");

  await test("clears all items for a button", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    storageBackend.set("backlogs", { a: [{content:"https://x.com/",type:"url",addedAt:1}], b: [{content:"https://y.com/",type:"url",addedAt:2}] });
    const r = await bg.clearBacklog("a");
    truthy(r.ok); eq(r.total, 0);
    eq(getBacklogs().a, undefined);
    eq(getBacklogs().b.length, 1);
  });

  console.log("\n=== deleteBacklog ===");

  await test("removes orphan backlog key", async () => {
    storageBackend.set("backlogs", { a: [{content:"x",type:"selection",addedAt:1}], b: [{content:"y",type:"selection",addedAt:2}] });
    const r = await bg.deleteBacklog("a");
    truthy(r.ok);
    eq(getBacklogs().a, undefined);
    eq(getBacklogs().b.length, 1);
  });

  await test("rejects empty buttonId", async () => {
    const r = await bg.deleteBacklog("");
    falsy(r.ok);
  });

  await test("no-op when key doesn't exist", async () => {
    storageBackend.set("backlogs", { a: [{content:"x",type:"selection",addedAt:1}] });
    const r = await bg.deleteBacklog("nonexistent");
    truthy(r.ok);
    eq(getBacklogs().a.length, 1);
  });

  console.log("\n=== saveButtons ===");

  await test("saves valid buttons", async () => {
    const buttons = [{id:"a",name:"A",contentMode:"auto",promptTemplate:"x {content}"}];
    const r = await bg.saveButtons(buttons);
    truthy(r.ok);
    eq(storageBackend.get("buttons"), buttons);
  });

  await test("rejects malformed buttons", async () => {
    const r = await bg.saveButtons([{id:"a"}]); // missing fields
    falsy(r.ok);
  });

  await test("quota error surfaces", async () => {
    quotaExceeded = true;
    const r = await bg.saveButtons([{id:"a",name:"A",contentMode:"auto",promptTemplate:"x"}]);
    falsy(r.ok);
  });

  console.log("\n=== saveQuickAddTarget ===");

  await test("saves quickAddTarget string", async () => {
    const r = await bg.saveQuickAddTarget("btn-123");
    truthy(r.ok);
    eq(storageBackend.get("quickAddTarget"), "btn-123");
  });

  await test("saves empty string", async () => {
    const r = await bg.saveQuickAddTarget("");
    truthy(r.ok);
    eq(storageBackend.get("quickAddTarget"), "");
  });

  await test("rejects non-string", async () => {
    const r = await bg.saveQuickAddTarget(42);
    falsy(r.ok);
  });

  console.log("\n=== serializeWrite (concurrency) ===");

  await test("two concurrent addToBacklog calls don't lose updates", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const [r1, r2] = await Promise.all([
      bg.addToBacklog("a", [{content:"https://x.com",type:"url",addedAt:1}]),
      bg.addToBacklog("a", [{content:"https://y.com",type:"url",addedAt:2}])
    ]);
    truthy(r1.ok); truthy(r2.ok);
    const items = getBacklogs().a.map(it => it.content).sort();
    eq(items, ["https://x.com/", "https://y.com/"]);
  });

  await test("100 concurrent adds all complete", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const ops = [];
    for (let i = 0; i < 100; i++) {
      ops.push(bg.addToBacklog("a", [{content:"https://example.com/" + i,type:"url",addedAt:i}]));
    }
    const results = await Promise.all(ops);
    eq(results.filter(r => r.ok).length, 100);
    eq(getBacklogs().a.length, 100);
  });

  await test("addToBacklog + clearBacklog interleaved leaves consistent state", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const [r1, r2, r3] = await Promise.all([
      bg.addToBacklog("a", [{content:"https://x.com",type:"url",addedAt:1}]),
      bg.clearBacklog("a"),
      bg.addToBacklog("a", [{content:"https://y.com",type:"url",addedAt:2}])
    ]);
    truthy(r1.ok); truthy(r2.ok); truthy(r3.ok);
    eq(getBacklogs().a.length, 1);
    eq(getBacklogs().a[0].content, "https://y.com/");
  });

  console.log("\n=== handleQuickAddLink ===");

  await test("rejects when no quickAddTarget set", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    const r = await bg.handleQuickAddLink("https://x.com");
    falsy(r.ok);
  });

  await test("adds when target is set", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    storageBackend.set("quickAddTarget", "a");
    const r = await bg.handleQuickAddLink("https://x.com");
    truthy(r.ok); eq(r.added, 1);
  });

  await test("rejects non-http URL", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    storageBackend.set("quickAddTarget", "a");
    const r = await bg.handleQuickAddLink("javascript:alert(1)");
    falsy(r.ok);
  });

  await test("rejects null URL", async () => {
    seedButtons([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]);
    storageBackend.set("quickAddTarget", "a");
    const r = await bg.handleQuickAddLink(null);
    falsy(r.ok);
  });

  console.log("\n=== handleButtonExecution ===");

  await test("validates button object", async () => {
    const r = await bg.handleButtonExecution(null, "x");
    falsy(r.ok);
  });

  await test("validates promptTemplate is string", async () => {
    const r = await bg.handleButtonExecution({promptTemplate: 42}, "x");
    falsy(r.ok);
  });

  await test("rejects invalid projectUuid format", async () => {
    const r = await bg.handleButtonExecution({promptTemplate:"x",projectUuid:"../evil"}, "x");
    falsy(r.ok);
  });

  await test("accepts UUID-format projectUuid", async () => {
    // valid UUID format (32-40 hex chars + hyphens)
    const r = await bg.handleButtonExecution({promptTemplate:"x {content}",projectUuid:"01234567-89ab-cdef-0123-456789abcdef"}, "test");
    truthy(r.ok);
  });

  await test("accepts no projectUuid (new chat)", async () => {
    const r = await bg.handleButtonExecution({promptTemplate:"x {content}"}, "test");
    truthy(r.ok);
  });

  console.log("\n=== runMigration ===");

  await test("migrates bare-string backlog entries", async () => {
    storageBackend.set("buttons", [{id:"a",name:"A",contentMode:"auto",promptTemplate:"x"}]);
    storageBackend.set("backlogs", { a: ["https://x.com", "https://y.com"] });
    await bg.runMigration();
    const bl = getBacklogs().a;
    eq(bl.length, 2);
    truthy(typeof bl[0].content === "string");
    truthy(typeof bl[0].addedAt === "number");
    eq(bl[0].type, "url");
    eq(storageBackend.get("schemaVersion"), 2);
  });

  await test("migrates buttons missing fields", async () => {
    storageBackend.set("buttons", [{name:"A",promptTemplate:"x"}]);
    await bg.runMigration();
    const b = storageBackend.get("buttons")[0];
    truthy(typeof b.id === "string");
    eq(b.contentMode, "auto");
    eq(b.autoSend, false);
    eq(b.autoClose, false);
  });

  await test("idempotent (re-run is no-op)", async () => {
    storageBackend.set("buttons", [{id:"a",name:"A",contentMode:"auto",promptTemplate:"x",autoSend:false,autoClose:false}]);
    storageBackend.set("backlogs", { a: [{content:"https://x.com/",type:"url",addedAt:1}] });
    storageBackend.set("schemaVersion", 2);
    const beforeButtons = JSON.stringify(storageBackend.get("buttons"));
    const beforeBacklogs = JSON.stringify(storageBackend.get("backlogs"));
    await bg.runMigration();
    eq(JSON.stringify(storageBackend.get("buttons")), beforeButtons);
    eq(JSON.stringify(storageBackend.get("backlogs")), beforeBacklogs);
  });

  console.log("\n=== updateBadge ===");

  await test("badge shows total backlog count", async () => {
    storageBackend.set("backlogs", { a: [{content:"x"},{content:"y"}], b: [{content:"z"}] });
    await bg.updateBadge();
    eq(badgeText, "3");
  });

  await test("badge empty when zero items", async () => {
    storageBackend.set("backlogs", {});
    await bg.updateBadge();
    eq(badgeText, "");
  });

  await test("badge handles non-array items defensively", async () => {
    storageBackend.set("backlogs", { a: "not an array", b: [{content:"x"}] });
    await bg.updateBadge();
    eq(badgeText, "1");
  });

  // --- Final report ---
  console.log("\n========================================");
  console.log(pass + " passed, " + fail + " failed");
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f.name + ": " + f.error));
  }
  process.exit(fail > 0 ? 1 : 0);
})();
