/*
 * Record-scoped local adapter for the temporary private Tally Clicker sync.
 * The app still keeps its proven browser-local snapshot format; this layer
 * maps that snapshot into independently revisioned records and only writes
 * validated records back into the snapshot. It deliberately excludes shared
 * Student Shuffle classes because that service is already authoritative.
 */
(() => {
  "use strict";

  const APP_ID = "tally-clicker";
  const PRIMARY_KEYS = [
    "custom-points-counter-state-v5",
    "custom-points-counter-state-v4",
    "custom-points-counter-state-v3",
    "custom-points-counter-state-v2",
  ];
  const PRIMARY_WRITE_KEY = PRIMARY_KEYS[0];
  const STREAK_KEY = "streak-counter-state-v2";
  const SOUND_KEY = "streak-counter-sound-v1";
  const MAX_ID_BYTES = 168;

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  function safeJson(value, depth = 0) {
    if (depth > 48 || value === null) return depth <= 48;
    if (typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 20_000 && value.every((item) => safeJson(item, depth + 1));
    if (!isObject(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= 20_000 && entries.every(([key, item]) => (
      key.length <= 240 && !["__proto__", "constructor", "prototype"].includes(key)
      && safeJson(item, depth + 1)
    ));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseObject(raw) {
    if (typeof raw !== "string") return null;
    try {
      const value = JSON.parse(raw);
      return isObject(value) && safeJson(value) ? value : null;
    } catch {
      return null;
    }
  }

  function readPrimary() {
    for (const key of PRIMARY_KEYS) {
      const value = parseObject(window.localStorage.getItem(key));
      if (value) return value;
    }
    return null;
  }

  function readStreak() {
    return parseObject(window.localStorage.getItem(STREAK_KEY));
  }

  function readSnapshot() {
    const sound = window.localStorage.getItem(SOUND_KEY);
    return {
      primary: readPrimary(),
      streak: readStreak(),
      sound: sound === "on" || sound === "off" ? sound : null,
    };
  }

  function makeRecordId(prefix, sourceId) {
    if (typeof sourceId !== "string" || !sourceId) return null;
    const bytes = new TextEncoder().encode(sourceId);
    if (bytes.byteLength > MAX_ID_BYTES) return null;
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return `${prefix}-${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
  }

  function arrayRecords(items, prefix, validate, transform = (value) => value) {
    const records = [];
    if (!Array.isArray(items)) return records;
    const seen = new Set();
    for (const item of items) {
      if (!validate(item)) continue;
      const recordId = makeRecordId(prefix, item.id);
      if (!recordId || seen.has(recordId)) continue;
      seen.add(recordId);
      records.push({ recordId, value: transform(clone(item)) });
    }
    return records;
  }

  function validCounter(value) {
    return isObject(value) && typeof value.id === "string" && makeRecordId("counter", value.id) !== null
      && typeof value.name === "string" && value.name.length <= 240
      && Number.isFinite(Number(value.score)) && typeof value.hidden === "boolean" && safeJson(value);
  }

  function isSharedClass(value) {
    return Boolean(value?.sharedRosterKey) || String(value?.id || "").startsWith("student-shuffler:");
  }

  function validClass(value) {
    return isObject(value) && !isSharedClass(value) && typeof value.id === "string"
      && makeRecordId("class", value.id) !== null && typeof value.name === "string"
      && value.name.length <= 240 && Array.isArray(value.students)
      && value.students.every((student) => typeof student === "string" && student.length <= 240)
      && isObject(value.neededByStudent) && safeJson(value);
  }

  function validTodo(value) {
    return isObject(value) && typeof value.id === "string" && makeRecordId("todo", value.id) !== null
      && typeof value.name === "string" && value.name.length <= 240
      && Array.isArray(value.skills) && safeJson(value);
  }

  function validStreakStudent(value) {
    return isObject(value) && typeof value.id === "string" && makeRecordId("student", value.id) !== null
      && typeof value.name === "string" && value.name.length <= 240
      && Number.isFinite(Number(value.streak)) && Number.isFinite(Number(value.target))
      && Number.isFinite(Number(value.points)) && typeof value.hidden === "boolean" && safeJson(value);
  }

  function validStopwatch(value) {
    return isObject(value) && typeof value.classId === "string"
      && makeRecordId("stopwatch", value.classId) !== null
      && isObject(value.records) && safeJson(value.records);
  }

  function validPreferences(value) {
    return isObject(value) && !own(value, "multiple") && !own(value, "classes")
      && !own(value, "lists") && !own(value, "stopwatch") && safeJson(value);
  }

  function validStopwatchSettings(value) {
    return isObject(value) && Object.keys(value).length === 2
      && own(value, "activeClassId") && own(value, "recordDate")
      && (value.activeClassId === null || typeof value.activeClassId === "string")
      && typeof value.recordDate === "string" && value.recordDate.length <= 80;
  }

  function validStreakPreferences(value) {
    return isObject(value) && !own(value, "students") && safeJson(value);
  }

  function validSound(value) {
    return isObject(value) && Object.keys(value).length === 1 && typeof value.enabled === "boolean";
  }

  function preferencesFrom(primary) {
    const value = {};
    for (const [key, item] of Object.entries(primary || {})) {
      if (!["multiple", "classes", "lists", "stopwatch"].includes(key)) value[key] = clone(item);
    }
    return value;
  }

  function stopwatchSettingsFrom(primary) {
    const source = isObject(primary?.stopwatch) ? primary.stopwatch : {};
    return {
      activeClassId: typeof source.activeClassId === "string" ? source.activeClassId : null,
      recordDate: typeof source.recordDate === "string" ? source.recordDate : "",
    };
  }

  function semanticRecords(snapshot) {
    const records = {
      preferences: new Map(),
      counters: new Map(),
      classes: new Map(),
      todos: new Map(),
      stopwatchSettings: new Map(),
      stopwatch: new Map(),
      streakPreferences: new Map(),
      streakStudents: new Map(),
      sound: new Map(),
    };
    const primary = snapshot.primary;
    if (isObject(primary)) {
      records.preferences.set("current", preferencesFrom(primary));
      records.stopwatchSettings.set("current", stopwatchSettingsFrom(primary));
      arrayRecords(primary.multiple, "counter", validCounter).forEach((item) => records.counters.set(item.recordId, item.value));
      arrayRecords(primary.classes, "class", validClass).forEach((item) => records.classes.set(item.recordId, item.value));
      arrayRecords(primary.lists, "todo", validTodo).forEach((item) => records.todos.set(item.recordId, item.value));
      const rawRecords = isObject(primary.stopwatch?.records) ? primary.stopwatch.records : {};
      for (const [classId, values] of Object.entries(rawRecords)) {
        const value = { classId, records: clone(values) };
        if (!validStopwatch(value)) continue;
        records.stopwatch.set(makeRecordId("stopwatch", classId), value);
      }
    }
    const streak = snapshot.streak;
    if (isObject(streak)) {
      const preferences = {};
      for (const [key, value] of Object.entries(streak)) {
        if (key !== "students") preferences[key] = clone(value);
      }
      if (validStreakPreferences(preferences)) records.streakPreferences.set("current", preferences);
      arrayRecords(streak.students, "student", validStreakStudent).forEach((item) => records.streakStudents.set(item.recordId, item.value));
    }
    if (snapshot.sound !== null) records.sound.set("current", { enabled: snapshot.sound !== "off" });
    return records;
  }

  function itemByRecordId(items, prefix, recordId) {
    if (!Array.isArray(items)) return { index: -1, item: null };
    const index = items.findIndex((item) => makeRecordId(prefix, item?.id) === recordId);
    return { index, item: index >= 0 ? items[index] : null };
  }

  let handles = null;
  let remoteWriteDepth = 0;
  let pendingBefore = null;
  let stageTimer = null;
  let remoteRefreshTimer = null;

  function dispatchRemoteRefresh() {
    if (remoteRefreshTimer !== null) return;
    remoteRefreshTimer = window.setTimeout(() => {
      remoteRefreshTimer = null;
      window.dispatchEvent(new CustomEvent("tally-semantic-sync-remote-applied"));
    }, 0);
  }

  function withRemoteWrite(task) {
    remoteWriteDepth += 1;
    try {
      task();
    } finally {
      remoteWriteDepth -= 1;
    }
    dispatchRemoteRefresh();
  }

  function writePrimary(primary) {
    window.localStorage.setItem(PRIMARY_WRITE_KEY, JSON.stringify(primary));
  }

  function writeStreak(streak) {
    window.localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  }

  function stageChanges(before, after) {
    if (!handles) return;
    const oldRecords = semanticRecords(before);
    const newRecords = semanticRecords(after);
    const descriptors = [
      ["preferences", true], ["counters", false], ["classes", false], ["todos", false],
      ["stopwatchSettings", true], ["stopwatch", false], ["streakPreferences", true],
      ["streakStudents", false], ["sound", true],
    ];
    for (const [name, fixed] of descriptors) {
      const handle = handles[name];
      if (!handle) continue;
      const previous = oldRecords[name];
      const current = newRecords[name];
      for (const [recordId, value] of current) {
        if (!previous.has(recordId) || !equal(previous.get(recordId), value)) {
          void handle.save(recordId, value);
        }
      }
      if (!fixed) {
        for (const recordId of previous.keys()) {
          if (!current.has(recordId)) void handle.remove(recordId);
        }
      }
    }
  }

  function queueStage(before) {
    if (!handles || remoteWriteDepth) return;
    if (!pendingBefore) pendingBefore = before;
    if (stageTimer !== null) return;
    stageTimer = window.setTimeout(() => {
      stageTimer = null;
      const original = pendingBefore;
      pendingBefore = null;
      if (original) stageChanges(original, readSnapshot());
    }, 0);
  }

  function relevantKey(key) {
    return key === PRIMARY_WRITE_KEY || key === STREAK_KEY || key === SOUND_KEY;
  }

  function installStorageObserver() {
    if (typeof Storage === "undefined" || Storage.prototype.__tallySemanticObserver) return;
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    Object.defineProperty(Storage.prototype, "__tallySemanticObserver", { value: true });
    Storage.prototype.setItem = function setItem(key, value) {
      const before = relevantKey(String(key)) && !remoteWriteDepth ? readSnapshot() : null;
      const result = originalSet.call(this, key, value);
      if (before) queueStage(before);
      return result;
    };
    Storage.prototype.removeItem = function removeItem(key) {
      const before = relevantKey(String(key)) && !remoteWriteDepth ? readSnapshot() : null;
      const result = originalRemove.call(this, key);
      if (before) queueStage(before);
      return result;
    };
  }

  function applyPrimaryPreferences(value, deleted) {
    if (deleted || !validPreferences(value)) throw new Error("The synchronized Tally preferences are invalid.");
    const primary = clone(readPrimary() || {});
    Object.assign(primary, clone(value));
    writePrimary(primary);
  }

  function applyStopwatchSettings(value, deleted) {
    if (deleted || !validStopwatchSettings(value)) throw new Error("The synchronized stopwatch settings are invalid.");
    const primary = clone(readPrimary() || {});
    const current = isObject(primary.stopwatch) ? primary.stopwatch : { records: {} };
    primary.stopwatch = { ...current, activeClassId: value.activeClassId, recordDate: value.recordDate };
    writePrimary(primary);
  }

  function applyPrimaryList(key, prefix, validator, recordId, value, deleted, skip = () => false) {
    const primary = clone(readPrimary() || {});
    const current = Array.isArray(primary[key]) ? primary[key] : [];
    const match = itemByRecordId(current, prefix, recordId);
    if (deleted) {
      if (match.index >= 0) current.splice(match.index, 1);
    } else {
      if (!validator(value) || makeRecordId(prefix, value.id) !== recordId || skip(value)) {
        throw new Error("The synchronized Tally record is invalid.");
      }
      if (match.index >= 0) current[match.index] = clone(value);
      else current.push(clone(value));
    }
    primary[key] = current;
    writePrimary(primary);
  }

  function applyStopwatch(recordId, value, deleted) {
    const primary = clone(readPrimary() || {});
    const stopwatch = isObject(primary.stopwatch) ? primary.stopwatch : { activeClassId: null, recordDate: "", records: {} };
    const records = isObject(stopwatch.records) ? stopwatch.records : {};
    const match = Object.keys(records).find((classId) => makeRecordId("stopwatch", classId) === recordId);
    if (deleted) {
      if (match) delete records[match];
    } else {
      if (!validStopwatch(value) || makeRecordId("stopwatch", value.classId) !== recordId) {
        throw new Error("The synchronized stopwatch record is invalid.");
      }
      records[value.classId] = clone(value.records);
    }
    primary.stopwatch = { ...stopwatch, records };
    writePrimary(primary);
  }

  function applyStreakPreferences(value, deleted) {
    if (deleted || !validStreakPreferences(value)) throw new Error("The synchronized streak preferences are invalid.");
    const streak = clone(readStreak() || { students: [] });
    const students = Array.isArray(streak.students) ? streak.students : [];
    Object.assign(streak, clone(value), { students });
    writeStreak(streak);
  }

  function applyStreakStudent(recordId, value, deleted) {
    const streak = clone(readStreak() || { students: [] });
    const students = Array.isArray(streak.students) ? streak.students : [];
    const match = itemByRecordId(students, "student", recordId);
    if (deleted) {
      if (match.index >= 0) students.splice(match.index, 1);
    } else {
      if (!validStreakStudent(value) || makeRecordId("student", value.id) !== recordId) {
        throw new Error("The synchronized streak student is invalid.");
      }
      if (match.index >= 0) students[match.index] = clone(value);
      else students.push(clone(value));
    }
    streak.students = students;
    writeStreak(streak);
  }

  function makeAdapters() {
    return {
      preferences: {
        scope: APP_ID, appId: APP_ID, collection: "preferences", recordId: "current", schemaVersion: 1,
        validate: validPreferences,
        readLocal: () => semanticRecords(readSnapshot()).preferences.get("current"),
        applyRemote: (value, metadata) => {
          if (metadata?.source !== "remote") throw new Error("Invalid private-sync source.");
          withRemoteWrite(() => applyPrimaryPreferences(value, Boolean(metadata.deleted)));
        },
      },
      counters: {
        scope: APP_ID, appId: APP_ID, collection: "counters", schemaVersion: 1,
        validate: validCounter,
        listLocal: () => Array.from(semanticRecords(readSnapshot()).counters, ([recordId, value]) => ({ recordId, value })),
        applyRemote: (recordId, value, metadata) => {
          if (metadata?.source !== "remote") throw new Error("Invalid private-sync source.");
          withRemoteWrite(() => applyPrimaryList("multiple", "counter", validCounter, recordId, value, Boolean(metadata.deleted)));
        },
      },
      classes: {
        scope: APP_ID, appId: APP_ID, collection: "classes", schemaVersion: 1,
        validate: validClass,
        listLocal: () => Array.from(semanticRecords(readSnapshot()).classes, ([recordId, value]) => ({ recordId, value })),
        applyRemote: (recordId, value, metadata) => {
          if (metadata?.source !== "remote") throw new Error("Invalid private-sync source.");
          withRemoteWrite(() => applyPrimaryList("classes", "class", validClass, recordId, value, Boolean(metadata.deleted), isSharedClass));
        },
      },
      todos: {
        scope: APP_ID, appId: APP_ID, collection: "todo-lists", schemaVersion: 1,
        validate: validTodo,
        listLocal: () => Array.from(semanticRecords(readSnapshot()).todos, ([recordId, value]) => ({ recordId, value })),
        applyRemote: (recordId, value, metadata) => {
          if (metadata?.source !== "remote") throw new Error("Invalid private-sync source.");
          withRemoteWrite(() => applyPrimaryList("lists", "todo", validTodo, recordId, value, Boolean(metadata.deleted)));
        },
      },
      stopwatchSettings: {
        scope: APP_ID, appId: APP_ID, collection: "stopwatch-settings", recordId: "current", schemaVersion: 1,
        validate: validStopwatchSettings,
        readLocal: () => semanticRecords(readSnapshot()).stopwatchSettings.get("current"),
        applyRemote: (value, metadata) => {
          if (metadata?.source !== "remote") throw new Error("Invalid private-sync source.");
          withRemoteWrite(() => applyStopwatchSettings(value, Boolean(metadata.deleted)));
        },
      },
      stopwatch: {
        scope: APP_ID, appId: APP_ID, collection: "stopwatch-records", schemaVersion: 1,
        validate: validStopwatch,
        listLocal: () => Array.from(semanticRecords(readSnapshot()).stopwatch, ([recordId, value]) => ({ recordId, value })),
        applyRemote: (recordId, value, metadata) => {
          if (metadata?.source !== "remote") throw new Error("Invalid private-sync source.");
          withRemoteWrite(() => applyStopwatch(recordId, value, Boolean(metadata.deleted)));
        },
      },
      streakPreferences: {
        scope: APP_ID, appId: APP_ID, collection: "streak-preferences", recordId: "current", schemaVersion: 1,
        validate: validStreakPreferences,
        readLocal: () => semanticRecords(readSnapshot()).streakPreferences.get("current"),
        applyRemote: (value, metadata) => {
          if (metadata?.source !== "remote") throw new Error("Invalid private-sync source.");
          withRemoteWrite(() => applyStreakPreferences(value, Boolean(metadata.deleted)));
        },
      },
      streakStudents: {
        scope: APP_ID, appId: APP_ID, collection: "streak-students", schemaVersion: 1,
        validate: validStreakStudent,
        listLocal: () => Array.from(semanticRecords(readSnapshot()).streakStudents, ([recordId, value]) => ({ recordId, value })),
        applyRemote: (recordId, value, metadata) => {
          if (metadata?.source !== "remote") throw new Error("Invalid private-sync source.");
          withRemoteWrite(() => applyStreakStudent(recordId, value, Boolean(metadata.deleted)));
        },
      },
      sound: {
        scope: APP_ID, appId: APP_ID, collection: "sound", recordId: "current", schemaVersion: 1,
        validate: validSound,
        readLocal: () => semanticRecords(readSnapshot()).sound.get("current"),
        applyRemote: (value, metadata) => {
          if (metadata?.source !== "remote" || metadata.deleted || !validSound(value)) {
            throw new Error("The synchronized Tally sound setting is invalid.");
          }
          withRemoteWrite(() => window.localStorage.setItem(SOUND_KEY, value.enabled ? "on" : "off"));
        },
      },
    };
  }

  function attachHandles(next) {
    const expected = [
      "preferences", "counters", "classes", "todos", "stopwatchSettings", "stopwatch",
      "streakPreferences", "streakStudents", "sound",
    ];
    if (!isObject(next) || expected.some((key) => !next[key] || typeof next[key].save !== "function")) {
      throw new Error("Tally Clicker semantic sync handles are incomplete.");
    }
    if (["counters", "classes", "todos", "stopwatch", "streakStudents"].some((key) => typeof next[key].remove !== "function")) {
      throw new Error("Tally Clicker semantic sync removal handles are incomplete.");
    }
    handles = next;
  }

  installStorageObserver();
  window.TallyStorage = Object.freeze({ makeAdapters, attachHandles });
})();
