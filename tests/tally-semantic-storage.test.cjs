const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { TextDecoder, TextEncoder } = require("node:util");
const vm = require("node:vm");

class FakeStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

function boot(values) {
  const localStorage = new FakeStorage(values);
  const window = {
    localStorage,
    setTimeout(task) { task(); return 1; },
    dispatchEvent() {},
  };
  const context = vm.createContext({
    window,
    localStorage,
    Storage: FakeStorage,
    TextEncoder,
    TextDecoder,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
  });
  vm.runInContext(
    readFileSync(new URL("../tally-storage.js", `file://${__filename}`), "utf8"),
    context,
  );
  return { storage: localStorage, adapters: window.TallyStorage.makeAdapters() };
}

function primary() {
  return {
    mode: "multiple",
    single: 3,
    multiple: [
      { id: "counter-a", name: "red", score: 4, hidden: false },
      { id: "counter-b", name: "blue", score: 2, hidden: false },
    ],
    classes: [
      { id: "class-a", name: "Monday", students: ["Ava"], neededByStudent: { ava: 3 } },
      { id: "student-shuffler:shared", name: "Shared", students: ["Bea"], neededByStudent: {}, sharedRosterKey: "builtin:boys-nga" },
    ],
    lists: [{ id: "todo-a", name: "Floor", skills: [{ id: "skill-a", name: "Handstand", reps: 5, completed: 1, hidden: false }] }],
    stopwatch: { activeClassId: "class-a", recordDate: "2026-08-05", records: { "class-a": { ava: 1234 } } },
  };
}

test("Tally semantic storage exposes independent counters, private classes, lists, and stopwatch records", () => {
  const { adapters } = boot({
    "custom-points-counter-state-v5": JSON.stringify(primary()),
    "streak-counter-state-v2": JSON.stringify({ students: [{ id: "student-a", name: "Ava", streak: 2, target: 3, points: 1, hidden: false }], teamTarget: 5 }),
    "streak-counter-sound-v1": "on",
  });

  assert.equal(adapters.counters.listLocal().length, 2);
  assert.equal(adapters.classes.listLocal().length, 1, "shared-roster classes stay with their own service");
  assert.equal(adapters.todos.listLocal().length, 1);
  assert.equal(adapters.stopwatch.listLocal().length, 1);
  assert.equal(adapters.streakStudents.listLocal().length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(adapters.sound.readLocal())), { enabled: true });
});

test("Tally semantic remote apply changes only the addressed record and rejects an ID mismatch", () => {
  const source = primary();
  const { storage, adapters } = boot({ "custom-points-counter-state-v5": JSON.stringify(source) });
  const [counter] = adapters.counters.listLocal();

  adapters.counters.applyRemote(counter.recordId, { ...counter.value, score: 9 }, { source: "remote", deleted: false });
  let saved = JSON.parse(storage.getItem("custom-points-counter-state-v5"));
  assert.equal(saved.multiple.find((item) => item.id === "counter-a").score, 9);
  assert.equal(saved.multiple.find((item) => item.id === "counter-b").score, 2);

  assert.throws(
    () => adapters.counters.applyRemote(counter.recordId, { ...counter.value, id: "counter-b", score: 77 }, { source: "remote", deleted: false }),
    /invalid/,
  );
  saved = JSON.parse(storage.getItem("custom-points-counter-state-v5"));
  assert.equal(saved.multiple.find((item) => item.id === "counter-b").score, 2);
});

test("Tally semantic deletions remove only the selected list record", () => {
  const { storage, adapters } = boot({ "custom-points-counter-state-v5": JSON.stringify(primary()) });
  const [todo] = adapters.todos.listLocal();
  adapters.todos.applyRemote(todo.recordId, null, { source: "remote", deleted: true });
  const saved = JSON.parse(storage.getItem("custom-points-counter-state-v5"));
  assert.deepEqual(saved.lists, []);
  assert.equal(saved.multiple.length, 2);
});
