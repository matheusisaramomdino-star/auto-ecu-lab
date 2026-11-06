import { DEFAULT_FAVORITES, validModule } from "./modules.mjs";
import { SIMULATION_DEFAULTS } from "./core.mjs";

const DATABASE = "auto-ecu-lab-preferences";
const STORE = "settings";
const KEY = "device-v1";
export const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  automaticUpdates: true,
  favorites: DEFAULT_FAVORITES,
  simulation: SIMULATION_DEFAULTS,
});

export function validatePreferences(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.schemaVersion !== 1
  )
    throw new Error("Preferências do sistema em formato não suportado.");
  if (typeof input.automaticUpdates !== "boolean")
    throw new Error("Escolha se deseja atualizações automáticas.");
  if (
    !Array.isArray(input.favorites) ||
    input.favorites.length > 6 ||
    new Set(input.favorites).size !== input.favorites.length ||
    input.favorites.some((id) => !validModule(id) || id === "sistema")
  )
    throw new Error("Selecione até seis módulos válidos, sem repetição.");
  const simulation = { ...SIMULATION_DEFAULTS, ...input.simulation };
  if (
    !Object.values(simulation).every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) ||
    simulation.delay_s < 0 ||
    simulation.delay_s > 3 ||
    simulation.tau_s < 0.02 ||
    simulation.tau_s > 3 ||
    simulation.gamma < 0.3 ||
    simulation.gamma > 3 ||
    simulation.maximum_pct < 1 ||
    simulation.maximum_pct > 100
  )
    throw new Error("Parâmetros do simulador nas preferências são inválidos.");
  return {
    schemaVersion: 1,
    automaticUpdates: input.automaticUpdates,
    favorites: [...input.favorites],
    simulation,
  };
}
function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB)
      return reject(
        new Error("Não foi possível abrir as preferências locais."),
      );
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Não foi possível abrir as preferências locais."));
    request.onblocked = () =>
      reject(
        new Error("Feche as outras abas antes de alterar as preferências."),
      );
  });
}
export async function loadPreferences() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(KEY);
      request.onsuccess = () => {
        try {
          resolve(
            validatePreferences(
              request.result ?? structuredClone(DEFAULT_PREFERENCES),
            ),
          );
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () =>
        reject(new Error("Falha ao ler preferências locais."));
    });
  } finally {
    db.close();
  }
}
export async function savePreferences(value) {
  const validated = validatePreferences(value),
    db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(validated, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {};
      tx.onabort = () =>
        reject(
          new Error(
            "Não foi possível salvar as preferências. As anteriores foram mantidas.",
          ),
        );
    });
    return validated;
  } finally {
    db.close();
  }
}
