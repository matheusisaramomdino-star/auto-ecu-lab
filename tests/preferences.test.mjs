import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import {
  validatePreferences,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "../dist/preferences.mjs";
import { APP_MODULES, APP_VERSION } from "../dist/modules.mjs";

test("preferências usam banco independente e persistem entre carregamentos", async () => {
  const old = globalThis.indexedDB;
  globalThis.indexedDB = indexedDB;
  try {
    const defaults = await loadPreferences();
    assert.equal(defaults.automaticUpdates, true);
    const saved = await savePreferences({
      schemaVersion: 1,
      automaticUpdates: false,
      favorites: ["veiculos", "simulador"],
    });
    assert.deepEqual(await loadPreferences(), saved);
    const other = await import("../dist/preferences.mjs?other-instance");
    assert.deepEqual(await other.loadPreferences(), saved);
  } finally {
    globalThis.indexedDB = old;
  }
});
test("configurações inválidas não habilitam módulos desconhecidos ou código remoto", () => {
  assert.throws(() =>
    validatePreferences({
      ...DEFAULT_PREFERENCES,
      favorites: ["https://example.com/code.mjs"],
    }),
  );
  assert.throws(() =>
    validatePreferences({
      ...DEFAULT_PREFERENCES,
      favorites: ["analise", "analise"],
    }),
  );
  assert.throws(() =>
    validatePreferences({ ...DEFAULT_PREFERENCES, automaticUpdates: "true" }),
  );
  assert.throws(() =>
    validatePreferences({ ...DEFAULT_PREFERENCES, schemaVersion: 2 }),
  );
});
test("registro preserva sete destinos de navegação e acrescenta Base no mesmo app", () => {
  assert.match(APP_VERSION, /^2\.2\./);
  assert.deepEqual(
    APP_MODULES.filter((m) => m.navigation !== false).map((m) => m.id),
    [
      "analise",
      "conexoes",
      "veiculos",
      "importar",
      "simulador",
      "relatorios",
      "sistema",
    ],
  );
  const base = APP_MODULES.find((m) => m.id === "base");
  assert.equal(base.label, "Base real e estatísticas");
  assert.equal(base.short, "Base");
  assert.equal(base.navigation, false);
  assert.equal(base.icon, "database");
  assert.ok(APP_MODULES.every((m) => m.label && m.description));
});
