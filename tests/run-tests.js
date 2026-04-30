// Promptly — Tier 1 unit tests for pure helpers
// Loads source files into a sandbox with stubbed browser API and exercises pure functions.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = path.resolve(__dirname, "..");

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
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
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
      setBadgeText: () => Promise.resolve(),
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
function test(name, fn) {
  try {
    fn();
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

// --- Load background.js ---
const bg = {
  browser: makeBrowser(), console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, URL, Set, Map, JSON, Date, Object, Array, Boolean, Number, String, RegExp, Math, Symbol, Error
};
bg.globalThis = bg;
bg.global = bg;
loadScript("scripts/background.js", bg);

console.log("\n=== normalizeUrl ===");
test("http URL → trailing slash", () => eq(bg.normalizeUrl("http://example.com"), "http://example.com/"));
test("https URL lowercased", () => eq(bg.normalizeUrl("https://Example.COM/"), "https://example.com/"));
test("hash stripped", () => eq(bg.normalizeUrl("https://example.com/page#section"), "https://example.com/page"));
test("trailing slash on path stripped", () => eq(bg.normalizeUrl("https://example.com/page/"), "https://example.com/page"));
test("query preserved", () => eq(bg.normalizeUrl("https://example.com/p?x=1"), "https://example.com/p?x=1"));
test("javascript: rejected", () => eq(bg.normalizeUrl("javascript:alert(1)"), null));
test("mailto: rejected", () => eq(bg.normalizeUrl("mailto:foo@bar"), null));
test("file: rejected", () => eq(bg.normalizeUrl("file:///etc/passwd"), null));
test("data: rejected", () => eq(bg.normalizeUrl("data:text/html,x"), null));
test("garbage rejected", () => eq(bg.normalizeUrl("not a url"), null));
test("null rejected", () => eq(bg.normalizeUrl(null), null));
test("empty rejected", () => eq(bg.normalizeUrl(""), null));
test("URL with port preserved", () => eq(bg.normalizeUrl("https://example.com:8080/p"), "https://example.com:8080/p"));
test("Wikipedia URL with parens", () => eq(bg.normalizeUrl("https://en.wikipedia.org/wiki/Foo_(bar)"), "https://en.wikipedia.org/wiki/Foo_(bar)"));

console.log("\n=== isProtectedUrl ===");
test("about: protected", () => eq(bg.isProtectedUrl("about:config"), true));
test("chrome: protected", () => eq(bg.isProtectedUrl("chrome://newtab/"), true));
test("moz-extension: protected", () => eq(bg.isProtectedUrl("moz-extension://abc/popup.html"), true));
test("view-source: protected", () => eq(bg.isProtectedUrl("view-source:https://example.com"), true));
test("file: protected", () => eq(bg.isProtectedUrl("file:///etc/passwd"), true));
test("data: protected", () => eq(bg.isProtectedUrl("data:text/html,<script>"), true));
test("javascript: protected", () => eq(bg.isProtectedUrl("javascript:alert(1)"), true));
test("blob: protected", () => eq(bg.isProtectedUrl("blob:https://example.com/uuid"), true));
test("resource: protected", () => eq(bg.isProtectedUrl("resource://gre/modules/Foo.jsm"), true));
test("https NOT protected", () => eq(bg.isProtectedUrl("https://example.com"), false));
test("http NOT protected", () => eq(bg.isProtectedUrl("http://example.com"), false));
test("null protected", () => eq(bg.isProtectedUrl(null), true));
test("empty protected", () => eq(bg.isProtectedUrl(""), true));

console.log("\n=== validateButtonsForSave ===");
test("valid single button", () =>
  eq(bg.validateButtonsForSave([{id:"a",name:"A",contentMode:"auto",promptTemplate:"x {content}"}]), null));
test("empty array OK", () => eq(bg.validateButtonsForSave([]), null));
test("not an array fails", () => truthy(typeof bg.validateButtonsForSave("nope") === "string"));
test("missing id fails", () => truthy(typeof bg.validateButtonsForSave([{name:"A",contentMode:"auto",promptTemplate:"x"}]) === "string"));
test("missing name string fails", () => truthy(typeof bg.validateButtonsForSave([{id:"a",contentMode:"auto",promptTemplate:"x"}]) === "string"));
test("name > 200 chars fails", () => truthy(typeof bg.validateButtonsForSave([{id:"a",name:"x".repeat(201),contentMode:"auto",promptTemplate:"x"}]) === "string"));
test("invalid contentMode fails", () => truthy(typeof bg.validateButtonsForSave([{id:"a",name:"A",contentMode:"wat",promptTemplate:"x"}]) === "string"));
test("contentMode url OK", () => eq(bg.validateButtonsForSave([{id:"a",name:"A",contentMode:"url",promptTemplate:"x"}]), null));
test("contentMode selection OK", () => eq(bg.validateButtonsForSave([{id:"a",name:"A",contentMode:"selection",promptTemplate:"x"}]), null));
test("template > 100KB fails", () => truthy(typeof bg.validateButtonsForSave([{id:"a",name:"A",contentMode:"auto",promptTemplate:"x".repeat(100*1024+1)}]) === "string"));
test("template at 100KB OK", () => eq(bg.validateButtonsForSave([{id:"a",name:"A",contentMode:"auto",promptTemplate:"x".repeat(100*1024)}]), null));
test("non-string template fails", () => truthy(typeof bg.validateButtonsForSave([{id:"a",name:"A",contentMode:"auto",promptTemplate:42}]) === "string"));

console.log("\n=== migrateButton ===");
test("null returns null", () => eq(bg.migrateButton(null), null));
test("non-object returns null", () => eq(bg.migrateButton(42), null));
test("complete button: changed=false", () => {
  const r = bg.migrateButton({id:"a",name:"A",contentMode:"auto",promptTemplate:"x",autoSend:false,autoClose:false});
  eq(r.changed, false);
});
test("missing id is generated", () => {
  const r = bg.migrateButton({name:"A",contentMode:"auto",promptTemplate:"x",autoSend:false,autoClose:false});
  eq(r.changed, true);
  truthy(typeof r.value.id === "string" && r.value.id.length > 0);
});
test("invalid contentMode defaults to auto", () => {
  const r = bg.migrateButton({id:"a",name:"A",contentMode:"wat",promptTemplate:"x"});
  eq(r.value.contentMode, "auto");
  eq(r.changed, true);
});
test("missing booleans default to false", () => {
  const r = bg.migrateButton({id:"a",name:"A",contentMode:"auto",promptTemplate:"x"});
  eq(r.value.autoSend, false);
  eq(r.value.autoClose, false);
});
test("idempotent (re-run on migrated value)", () => {
  const r1 = bg.migrateButton({name:"A",contentMode:"wat",promptTemplate:"x"});
  const r2 = bg.migrateButton(r1.value);
  eq(r2.changed, false);
});

console.log("\n=== migrateBacklogEntry ===");
test("bare string → URL entry", () => {
  const r = bg.migrateBacklogEntry("https://example.com");
  eq(r.value.content, "https://example.com");
  eq(r.value.type, "url");
  truthy(typeof r.value.addedAt === "number");
  eq(r.changed, true);
});
test("valid entry: changed=false", () => {
  const r = bg.migrateBacklogEntry({content:"https://example.com",type:"url",addedAt:1234});
  eq(r.changed, false);
  eq(r.value.addedAt, 1234);
});
test("missing type infers url for http content", () => {
  const r = bg.migrateBacklogEntry({content:"https://example.com",addedAt:1234});
  eq(r.value.type, "url");
});
test("missing type infers selection for non-url", () => {
  const r = bg.migrateBacklogEntry({content:"plain text",addedAt:1234});
  eq(r.value.type, "selection");
});
test("missing addedAt defaulted", () => {
  const r = bg.migrateBacklogEntry({content:"x",type:"selection"});
  truthy(typeof r.value.addedAt === "number");
});
test("non-string content rejected", () => eq(bg.migrateBacklogEntry({content:123,type:"url"}), null));
test("null rejected", () => eq(bg.migrateBacklogEntry(null), null));
test("idempotent", () => {
  const r1 = bg.migrateBacklogEntry("https://example.com");
  const r2 = bg.migrateBacklogEntry(r1.value);
  eq(r2.changed, false);
});

console.log("\n=== isFromExtensionPage ===");
test("null sender rejected", () => eq(bg.isFromExtensionPage(null), false));
test("undefined sender rejected", () => eq(bg.isFromExtensionPage(undefined), false));
test("wrong id rejected", () => eq(bg.isFromExtensionPage({id:"other@ext"}), false));
test("extension page (no tab) accepted", () => eq(bg.isFromExtensionPage({id:"test@ext"}), true));
test("content script with ext URL accepted", () =>
  eq(bg.isFromExtensionPage({id:"test@ext",tab:{id:1},url:"moz-extension://test/popup.html"}), true));
test("content script with foreign URL rejected", () =>
  eq(bg.isFromExtensionPage({id:"test@ext",tab:{id:1},url:"https://evil.com"}), false));
test("content script with no URL rejected", () =>
  eq(bg.isFromExtensionPage({id:"test@ext",tab:{id:1}}), false));

// --- Final report ---
console.log("\n========================================");
console.log(pass + " passed, " + fail + " failed");
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log("  - " + f.name + ": " + f.error));
}
process.exit(fail > 0 ? 1 : 0);
