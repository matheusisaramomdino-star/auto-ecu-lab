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
test("registro acrescenta BIN e compatibilidade sem apertar a navegação móvel", () => {
  assert.match(APP_VERSION, /^2\.3\./);
  const visible = APP_MODULES.filter((module) => module.navigation !== false);
  assert.deepEqual(
    visible.map((module) => module.id),
    [
      "analise",
      "conexoes",
      "veiculos",
      "importar",
      "simulador",
      "relatorios",
      "sistema",
      "binario",
    ],
  );
  assert.equal(
    visible.filter((module) => module.mobileNavigation !== false).length,
    7,
  );
  assert.equal(
    APP_MODULES.find((module) => module.id === "sistema").mobileNavigation,
    false,
  );
  const base = APP_MODULES.find((module) => module.id === "base");
  assert.equal(base.label, "Base real e estatísticas");
  assert.equal(base.short, "Base");
  assert.equal(base.navigation, false);
  assert.equal(base.icon, "database");
  assert.equal(
    APP_MODULES.find((module) => module.id === "compatibilidade").navigation,
    false,
  );
  assert.equal(APP_MODULES.length, 10);
  assert.ok(APP_MODULES.every((module) => module.label && module.description));
});
test("as ferramentas locais novas podem ser atalhos sem carregar código remoto", () => {
  assert.deepEqual(
    validatePreferences({
      ...DEFAULT_PREFERENCES,
      favorites: ["binario", "compatibilidade"],
    }).favorites,
    ["binario", "compatibilidade"],
  );
});
