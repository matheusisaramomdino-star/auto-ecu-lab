import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";

let instanceId = 0;
const instance = () => import(`../dist/store.mjs?concurrency-test=${++instanceId}`);

function state(title = "Ensaio original") {
  const vehicle = { id: "v1", brand: "Fiat", model: "Strada", year: 2022, engine: "1.4", plate: "FICTÍCIO", ecu: { source: "Não confirmada" } };
  return { schemaVersion: 1, vehicles: [vehicle], recordings: [{ id: "r1", vehicleId: "v1", title, filename: "teste.csv", createdAt: "2026-11-05T15:00:00Z", isDemo: true, vehicle: structuredClone(vehicle), samples: [{ time_s: 0, pedal_pct: 0, throttle_pct: 5, rpm: 850 }, { time_s: 0.1, pedal_pct: 50, throttle_pct: 5, rpm: 850 }], diagnostics: [], metadata: {}, analysisConfig: {} }], selectedId: "r1" };
}

async function rawValue(value, write = false) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("auto-ecu-lab-mobile", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("workspace");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction("workspace", write ? "readwrite" : "readonly");
      const store = transaction.objectStore("workspace");
      let result;
      const request = write ? store.put(value, "current") : store.get("current");
      request.onsuccess = () => result = request.result;
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}

async function withDatabase(callback) {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try { await callback(); }
  finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
}

test("duas abas não sobrescrevem alterações feitas após sua leitura", async () => withDatabase(async () => {
  const tabA = await instance(), tabB = await instance();
  assert.equal(await tabA.loadState(), null);
  await tabA.saveState(state());
  const staleB = await tabB.loadState();
  const updatedA = await tabA.loadState();
  updatedA.recordings[0].title = "Alteração da aba A";
  await tabA.saveState(updatedA);
  staleB.recordings[0].title = "Cópia antiga da aba B";
  await assert.rejects(tabB.saveState(staleB), /outra aba.*Recarregue/);
  const persisted = await rawValue();
  assert.equal(persisted.revision, 2);
  assert.equal(persisted.state.recordings[0].title, "Alteração da aba A");
  const refreshedB = await tabB.loadState();
  refreshedB.recordings[0].title = "Aba B depois de recarregar";
  await tabB.saveState(refreshedB);
  assert.equal((await rawValue()).revision, 3);
}));

test("primeiras gravações concorrentes têm somente um vencedor", async () => withDatabase(async () => {
  const tabA = await instance(), tabB = await instance();
  assert.equal(await tabA.loadState(), null);
  assert.equal(await tabB.loadState(), null);
  const outcomes = await Promise.allSettled([tabA.saveState(state("A")), tabB.saveState(state("B"))]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(item => item.status === "rejected").length, 1);
  assert.equal((await rawValue()).revision, 1);
}));

test("instância que não leu banco existente não pode substituí-lo", async () => withDatabase(async () => {
  const initial = await instance();
  await initial.saveState(state("Preservado"));
  const unread = await instance();
  await assert.rejects(unread.saveState(state("Não deve vencer")), /outra aba/);
  assert.equal((await rawValue()).state.recordings[0].title, "Preservado");
}));

test("estado legado é lido como revisão zero e migra somente após commit", async () => withDatabase(async () => {
  await rawValue(state("Legado"), true);
  const tabA = await instance(), tabB = await instance();
  const first = await tabA.loadState(), stale = await tabB.loadState();
  assert.equal(first.recordings[0].title, "Legado");
  assert.equal((await rawValue()).revision, undefined);
  await tabA.saveState(first);
  const migrated = await rawValue();
  assert.equal(migrated.revision, 1);
  assert.equal(migrated.state.schemaVersion, 1);
  await assert.rejects(tabB.saveState(stale), /outra aba/);
  const backup = JSON.parse(tabA.stateJSON(first));
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.revision, undefined);
  assert.equal(backup.state, undefined);
}));

test("abort genérico preserva estado e revisão e permite nova tentativa", async () => withDatabase(async () => {
  const tab = await instance();
  await tab.saveState(state("Antes do abort"));
  const changed = await tab.loadState();
  changed.recordings[0].title = "Depois da nova tentativa";
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = original.apply(this, args);
    this.transaction.abort();
    return request;
  };
  try { await assert.rejects(tab.saveState(changed), /Não foi possível salvar.*Nenhum dado anterior/); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.equal((await rawValue()).revision, 1);
  assert.equal((await rawValue()).state.recordings[0].title, "Antes do abort");
  await tab.saveState(changed);
  assert.equal((await rawValue()).revision, 2);
}));

test("erro de quota informa falha sem alterar revisão ou perder dados", async () => withDatabase(async () => {
  const tab = await instance();
  await tab.saveState(state("Antes da quota"));
  const changed = await tab.loadState();
  changed.recordings[0].title = "Depois da quota";
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException("quota de teste", "QuotaExceededError"); };
  try { await assert.rejects(tab.saveState(changed), /Espaço local insuficiente/); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.equal((await rawValue()).revision, 1);
  assert.equal((await rawValue()).state.recordings[0].title, "Antes da quota");
  await tab.saveState(changed);
  assert.equal((await rawValue()).revision, 2);
}));
