import { ANALYSIS_DEFAULTS, validateSamples } from "./core.mjs";
import { operationMode } from "./modes.mjs";

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const DATABASE = "auto-ecu-lab-mobile";
const STORE = "workspace";
const KEY = "current";
// Cada aba tem seu próprio módulo e conserva a revisão que efetivamente leu.
let loadedSnapshot = null;
const CONFLICT_MESSAGE =
  "Os dados foram alterados em outra aba ou janela do aplicativo. Recarregue ou reabra esta aba antes de continuar. Nenhum dado foi substituído.";
const QUOTA_MESSAGE =
  "Espaço local insuficiente. Exporte um backup e libere espaço no aparelho.";
const SAVE_MESSAGE =
  "Não foi possível salvar os dados no aparelho. Nenhum dado anterior foi substituído.";

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label}: objeto inválido.`);
  }
  return value;
}

function text(value, label, maximum = 200, required = false) {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (required && !value.trim())
  ) {
    fail(
      `${label}: informe um texto${required ? " não vazio" : ""} de até ${maximum} caracteres.`,
    );
  }
  return value;
}

function identifier(value, label) {
  return text(value, label, 100, true);
}

function vehicle(value, label) {
  object(value, label);
  const ecu = object(value.ecu, `${label}: ECU`);
  if (!Number.isInteger(value.year) || value.year < 1900 || value.year > 2100) {
    fail(`${label}: ano inválido.`);
  }
  return {
    id: identifier(value.id, `${label}: ID`),
    brand: text(value.brand, `${label}: marca`, 200, true),
    model: text(value.model, `${label}: modelo`, 200, true),
    year: value.year,
    engine: text(value.engine, `${label}: motor`, 200, true),
    plate: text(value.plate ?? "", `${label}: placa`),
    ecu: {
      manufacturer: text(ecu.manufacturer ?? "", `${label}: fabricante da ECU`),
      identification: text(
        ecu.identification ?? "",
        `${label}: identificação da ECU`,
      ),
      hardware: text(ecu.hardware ?? "", `${label}: hardware`),
      software: text(ecu.software ?? "", `${label}: software`),
      source: text(ecu.source ?? "Não confirmada", `${label}: origem da ECU`),
    },
  };
}

function jsonText(value) {
  try {
    const result = JSON.stringify(value, (_key, item) => {
      if (typeof item === "number" && !Number.isFinite(item))
        fail("O backup contém número não finito.");
      if (["undefined", "function", "symbol", "bigint"].includes(typeof item)) {
        fail("O backup contém um valor incompatível com JSON.");
      }
      return item;
    });
    if (typeof result !== "string") fail("Backup vazio ou inválido.");
    if (new TextEncoder().encode(result).byteLength > MAX_BACKUP_BYTES) {
      fail("O backup excede o limite de 25 MB.");
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError)
      fail("O backup contém uma estrutura circular ou incompatível com JSON.");
    if (error instanceof RangeError)
      fail("O backup contém uma estrutura profunda demais.");
    throw error;
  }
}

function finiteJson(value, depth = 0) {
  if (depth > 20) fail("Metadados do backup têm profundidade excessiva.");
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item) => finiteJson(item, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        fail("O backup contém uma chave de metadados não permitida.");
      }
      finiteJson(item, depth + 1);
    }
    return;
  }
  fail("Metadados do backup não são JSON válido.");
}

function analysisConfig(value) {
  object(value, "Configuração da análise");
  const result = { ...ANALYSIS_DEFAULTS };
  for (const key of Object.keys(result)) {
    if (value[key] !== undefined) result[key] = value[key];
    if (
      typeof result[key] !== "number" ||
      !Number.isFinite(result[key]) ||
      result[key] <= 0
    ) {
      fail("Parâmetros da análise devem ser positivos e finitos.");
    }
  }
  if (result.pedal_rise_pp > 100 || result.throttle_rise_pp > 100) {
    fail("Variações percentuais não podem exceder 100 pontos percentuais.");
  }
  return result;
}

/** Valida o backup inteiro antes de qualquer substituição do banco local. */
export function validateBackup(input) {
  // A cópia JSON também impede compartilhar referências mutáveis com a interface.
  const data = JSON.parse(jsonText(input));
  object(data, "Backup");
  if (data.schemaVersion !== 1)
    fail(
      "Versão de backup não suportada. Use um backup AUTO ECU LAB versão 1.",
    );
  if (!Array.isArray(data.vehicles) || data.vehicles.length > 250)
    fail("O backup aceita até 250 veículos.");
  if (!Array.isArray(data.recordings) || data.recordings.length > 200)
    fail("O backup aceita até 200 ensaios.");
  const vehicles = data.vehicles.map((item, i) =>
    vehicle(item, `Veículo ${i + 1}`),
  );
  const vehicleIds = new Set(vehicles.map((item) => item.id));
  if (vehicleIds.size !== vehicles.length)
    fail("O backup contém IDs de veículo duplicados.");
  const recordingIds = new Set();
  const recordings = data.recordings.map((item, i) => {
    const label = `Ensaio ${i + 1}`;
    object(item, label);
    const id = identifier(item.id, `${label}: ID`);
    if (recordingIds.has(id)) fail("O backup contém IDs de ensaio duplicados.");
    recordingIds.add(id);
    const vehicleId = identifier(item.vehicleId, `${label}: veículo`);
    if (!vehicleIds.has(vehicleId))
      fail(`${label}: veículo vinculado não encontrado no backup.`);
    const snapshot = vehicle(
      item.vehicle,
      `${label}: identificação preservada`,
    );
    if (snapshot.id !== vehicleId)
      fail(`${label}: identificação preservada pertence a outro veículo.`);
    if (!Array.isArray(item.samples) || item.samples.length > 50000)
      fail(`${label}: limite de 50.000 amostras excedido.`);
    validateSamples(item.samples);
    if (!Array.isArray(item.diagnostics) || item.diagnostics.length > 1000)
      fail(`${label}: lista de DTCs inválida (máximo 1.000).`);
    const diagnostics = item.diagnostics.map((dtc, index) => {
      object(dtc, `${label}: DTC ${index + 1}`);
      const code = text(dtc.code, "Código DTC", 5, true).toUpperCase();
      if (!/^[PCBU][0-3][0-9A-F]{3}$/.test(code))
        fail(`${label}: código DTC inválido.`);
      return {
        code,
        description: text(dtc.description, "Descrição DTC", 1000, true),
        status: text(dtc.status, "Estado DTC", 100, true),
      };
    });
    const createdAt = text(item.createdAt, `${label}: data`, 50, true);
    if (
      !/^\d{4}-\d{2}-\d{2}T/.test(createdAt) ||
      !Number.isFinite(Date.parse(createdAt))
    )
      fail(`${label}: data de criação inválida.`);
    if (typeof item.isDemo !== "boolean")
      fail(`${label}: identificação de dados fictícios inválida.`);
    const metadata = object(item.metadata, `${label}: metadados`);
    finiteJson(metadata);
    operationMode({ isDemo: item.isDemo, metadata });
    return {
      id,
      vehicleId,
      title: text(item.title, `${label}: título`, 150, true),
      filename: text(item.filename, `${label}: arquivo`, 255, true),
      createdAt,
      isDemo: item.isDemo,
      vehicle: snapshot,
      samples: item.samples.map((sample) => ({
        time_s: sample.time_s,
        pedal_pct: sample.pedal_pct,
        throttle_pct: sample.throttle_pct,
        rpm: sample.rpm,
      })),
      diagnostics,
      metadata,
      analysisConfig: analysisConfig(item.analysisConfig ?? {}),
    };
  });
  let selectedId = text(data.selectedId ?? "", "Ensaio selecionado", 100);
  if (selectedId && !recordingIds.has(selectedId))
    fail("O ensaio selecionado não existe no backup.");
  if (!selectedId && recordings.length) selectedId = recordings[0].id;
  return { schemaVersion: 1, vehicles, recordings, selectedId };
}

export function parseBackup(content) {
  if (
    typeof content !== "string" ||
    new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES
  ) {
    fail("Selecione um backup JSON de até 25 MB.");
  }
  let data;
  try {
    data = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    fail("Backup JSON inválido. O arquivo não foi importado.");
  }
  return validateBackup(data);
}

export function stateJSON(state) {
  // Compacto para que todo backup exportável respeite o mesmo limite de restauração.
  return JSON.stringify(validateBackup(state));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB)
      return reject(
        new Error(
          "O navegador não permite armazenamento local. Ative os dados de sites e tente novamente.",
        ),
      );
    let request;
    try {
      request = indexedDB.open(DATABASE, 1);
    } catch {
      return reject(
        new Error(
          "Não foi possível abrir o armazenamento local deste navegador.",
        ),
      );
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    let blocked = false;
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      reject(
        new Error(
          "Não foi possível abrir o armazenamento local deste navegador.",
        ),
      );
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Feche outras abas do AUTO ECU LAB e tente novamente."));
    };
  });
}

function storedRecord(value) {
  if (value === undefined) return { revision: 0, present: false, state: null };
  if (
    value &&
    typeof value === "object" &&
    Object.hasOwn(value, "revision") &&
    Object.hasOwn(value, "state")
  ) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
      fail(
        "A revisão dos dados locais é inválida. Não limpe o armazenamento antes de recuperar seu backup.",
      );
    }
    return { revision: value.revision, present: true, state: value.state };
  }
  // Compatibilidade com a primeira versão, que gravava o estado diretamente.
  if (value && typeof value === "object" && value.schemaVersion === 1) {
    return { revision: 0, present: true, state: value };
  }
  fail(
    "Os dados locais têm formato inválido. Não limpe o armazenamento antes de recuperar seu backup.",
  );
}

export async function loadState() {
  const database = await openDatabase();
  try {
    const value = await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error("Não foi possível ler os dados locais."));
    });
    const record = storedRecord(value);
    const state = record.present ? validateBackup(record.state) : null;
    loadedSnapshot = { revision: record.revision, present: record.present };
    return state;
  } finally {
    database.close();
  }
}

export async function saveState(state) {
  const validated = validateBackup(state);
  const expected = loadedSnapshot;
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let failure;
      let revision;
      // Comparar e escrever na MESMA transação impede duas abas de vencerem juntas.
      const request = store.get(KEY);
      request.onsuccess = () => {
        try {
          const current = storedRecord(request.result);
          if (
            (!expected && current.present) ||
            (expected &&
              (expected.revision !== current.revision ||
                expected.present !== current.present))
          ) {
            failure = new Error(CONFLICT_MESSAGE);
            transaction.abort();
            return;
          }
          if (current.revision === Number.MAX_SAFE_INTEGER)
            fail(
              "Limite de revisões locais atingido. Exporte um backup antes de continuar.",
            );
          revision = current.revision + 1;
          store.put({ revision, state: validated }, KEY);
        } catch (error) {
          failure =
            error?.name === "QuotaExceededError"
              ? new Error(QUOTA_MESSAGE)
              : error instanceof DOMException
                ? new Error(SAVE_MESSAGE)
                : error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        loadedSnapshot = { revision, present: true };
        resolve();
      };
      transaction.onabort = () =>
        reject(
          failure ||
            new Error(
              transaction.error?.name === "QuotaExceededError"
                ? QUOTA_MESSAGE
                : SAVE_MESSAGE,
            ),
        );
      transaction.onerror = () => {};
    });
  } finally {
    database.close();
  }
}
