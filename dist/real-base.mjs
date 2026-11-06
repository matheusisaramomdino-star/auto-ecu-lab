/** Quarentena local dos exemplos antigos. Não acessa rede nem hardware. */
export const KNOWN_SYNTHETIC_HASHES = Object.freeze([
  "53254c006f64532c1945b6af348cf578c34f6f3317945fd1ca75e4da5417c737",
  "7e76d92b651f3a22d5a1690e858e2b446e44e26361b32a1973cf8c6eb2187e8a",
  "104d34f93c0d865b50ede79c6b77690dc0db89e066963dcad33b398cacc8b81f",
  "25ec1b8ac5d63fbb95abe8266c5c055ba6904be136a6b4a164894c8b7bb96cb6",
  "f95fc65de33bd4d83fdc7187504b13a0784537c61a95fc80da3e08f39db192cb",
  "c2fa25a7f72d13d5e10ef85ae46f1288273eac2f013a948a273d05428edc7666",
]);

const syntheticHashes = new Set(KNOWN_SYNTHETIC_HASHES);
const ARCHIVE_DATABASE = "auto-ecu-lab-legacy-archive";
const ARCHIVE_ERROR =
  "Não foi possível arquivar os exemplos antigos neste aparelho. Os dados ativos foram preservados.";

/** Só usa evidências explícitas; nome de arquivo, valores e ausência de origem não comprovam simulação. */
export function isSyntheticRecord(recording) {
  if (!recording || typeof recording !== "object") return false;
  if (recording.isDemo === true) return true;
  const metadata = recording.metadata;
  if (metadata?.operation_mode === "simulation") return true;
  return [metadata?.sha256, metadata?.provenance?.sha256].some(
    (hash) =>
      typeof hash === "string" && syntheticHashes.has(hash.toLowerCase()),
  );
}

function isSeedVehicle(vehicle) {
  if (
    vehicle.brand !== "Fiat" ||
    vehicle.model !== "Strada" ||
    vehicle.year !== 2022 ||
    vehicle.engine !== "1.4" ||
    vehicle.plate !== "DEMONSTRAÇÃO" ||
    !vehicle.ecu ||
    typeof vehicle.ecu !== "object" ||
    Array.isArray(vehicle.ecu)
  )
    return false;
  const ecu = vehicle.ecu;
  if (
    !["manufacturer", "identification", "hardware", "software"].every(
      (key) => ecu[key] === undefined || ecu[key] === "",
    )
  )
    return false;
  if (![undefined, "", "Não confirmada"].includes(ecu.source)) return false;
  // Campos de futuras integrações também podem conter uma identificação real.
  return Object.entries(ecu).every(
    ([key, value]) =>
      [
        "manufacturer",
        "identification",
        "hardware",
        "software",
        "source",
      ].includes(key) ||
      value === "" ||
      value === undefined,
  );
}

/** Planeja a mudança sem alterar a entrada nem escrever no armazenamento. */
export function prepareRealBase(state) {
  if (
    !state ||
    state.schemaVersion !== 1 ||
    !Array.isArray(state.recordings) ||
    !Array.isArray(state.vehicles)
  )
    throw new Error("Base local inválida para migração.");

  const synthetic = state.recordings.filter(isSyntheticRecord);
  if (!synthetic.length) {
    return { state, archivedRecordings: [], archivedVehicles: [] };
  }

  const next = structuredClone(state);
  const archivedRecordings = next.recordings.filter(isSyntheticRecord);
  next.recordings = next.recordings.filter(
    (recording) => !isSyntheticRecord(recording),
  );
  const syntheticVehicleIds = new Set(
    archivedRecordings.map((recording) => recording.vehicleId),
  );
  const activeVehicleIds = new Set(
    next.recordings.map((recording) => recording.vehicleId),
  );
  const shouldArchiveVehicle = (vehicle) =>
    syntheticVehicleIds.has(vehicle.id) &&
    !activeVehicleIds.has(vehicle.id) &&
    isSeedVehicle(vehicle);
  const archivedVehicles = next.vehicles.filter(shouldArchiveVehicle);
  next.vehicles = next.vehicles.filter(
    (vehicle) => !shouldArchiveVehicle(vehicle),
  );
  if (!next.recordings.some((recording) => recording.id === next.selectedId)) {
    next.selectedId = next.recordings[0]?.id || "";
  }
  return { state: next, archivedRecordings, archivedVehicles };
}

function openArchive() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error(ARCHIVE_ERROR));
      return;
    }
    let opening;
    let failed = false;
    try {
      opening = globalThis.indexedDB.open(ARCHIVE_DATABASE, 1);
    } catch {
      reject(new Error(ARCHIVE_ERROR));
      return;
    }
    const fail = () => {
      failed = true;
      reject(new Error(ARCHIVE_ERROR));
    };
    opening.onupgradeneeded = () => {
      for (const name of ["recordings", "vehicles"]) {
        if (!opening.result.objectStoreNames.contains(name)) {
          opening.result.createObjectStore(name, { keyPath: "id" });
        }
      }
    };
    opening.onerror = fail;
    opening.onblocked = fail;
    opening.onsuccess = () => {
      if (failed) {
        opening.result.close();
        return;
      }
      opening.result.onversionchange = () => opening.result.close();
      resolve(opening.result);
    };
  });
}

/** Uma cópia independente é confirmada antes de remover exemplos da base ativa. */
async function archiveLocally({ recordings, vehicles }) {
  const database = await openArchive();
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = database.transaction(
        ["recordings", "vehicles"],
        "readwrite",
      );
      const archivedAt = new Date().toISOString();
      const putVersion = (name, item, field) => {
        const store = transaction.objectStore(name);
        const request = store.get(item.id);
        request.onsuccess = () => {
          try {
            const previous = request.result;
            const payload = structuredClone(item);
            // Repetir uma migração não sobrescreve uma cópia anterior com o mesmo ID.
            if (
              previous &&
              JSON.stringify(previous[field]) === JSON.stringify(payload)
            )
              return;
            store.put({
              id: item.id,
              archivedAt,
              reason: "synthetic-legacy",
              [field]: payload,
              ...(previous ? { previous } : {}),
            });
          } catch {
            transaction.abort();
          }
        };
      };
      for (const recording of recordings)
        putVersion("recordings", recording, "recording");
      for (const vehicle of vehicles)
        putVersion("vehicles", vehicle, "vehicle");
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        reject(new Error(ARCHIVE_ERROR));
      };
      transaction.onerror = () => {}; // onabort informa a falha da transação inteira.
    } catch {
      if (transaction) transaction.abort();
      database.close();
      reject(new Error(ARCHIVE_ERROR));
    }
  });
}

/** commit deve gravar o novo snapshot pelo mecanismo normal de concorrência da base. */
export async function migrateRealBase(
  state,
  { commit, archive = archiveLocally } = {},
) {
  const prepared = prepareRealBase(state);
  const { archivedRecordings, archivedVehicles } = prepared;
  if (!archivedRecordings.length && !archivedVehicles.length) {
    return { state, removedRecordings: 0, removedVehicles: 0 };
  }
  if (typeof archive !== "function" || typeof commit !== "function") {
    throw new Error("A migração exige funções de arquivo e gravação válidas.");
  }
  // A função de arquivo recebe sua própria cópia para não poder alterar o novo estado.
  await archive(
    structuredClone({
      recordings: archivedRecordings,
      vehicles: archivedVehicles,
    }),
  );
  await commit(prepared.state);
  return {
    state: prepared.state,
    removedRecordings: archivedRecordings.length,
    removedVehicles: archivedVehicles.length,
  };
}
