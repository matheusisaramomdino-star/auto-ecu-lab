import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  KNOWN_SYNTHETIC_HASHES,
  isSyntheticRecord,
  prepareRealBase,
  migrateRealBase,
} from "../dist/real-base.mjs";

function seedVehicle(id = "v-demo") {
  return {
    id,
    brand: "Fiat",
    model: "Strada",
    year: 2022,
    engine: "1.4",
    plate: "DEMONSTRAÇÃO",
    ecu: {
      manufacturer: "",
      identification: "",
      hardware: "",
      software: "",
      source: "Não confirmada",
    },
  };
}

function recording(id, vehicle = seedVehicle(), extra = {}) {
  return {
    id,
    vehicleId: vehicle.id,
    vehicle: structuredClone(vehicle),
    title: "Arquivo de ensaio",
    filename: "ensaio.csv",
    isDemo: false,
    createdAt: "2026-11-06T10:00:00Z",
    samples: [
      { time_s: 0, pedal_pct: 0, throttle_pct: 5, rpm: 850 },
      { time_s: 0.1, pedal_pct: 30, throttle_pct: 5, rpm: 850 },
    ],
    diagnostics: [],
    metadata: {},
    ...extra,
  };
}

function workspace(
  recordings = [recording("synthetic", seedVehicle(), { isDemo: true })],
) {
  return {
    schemaVersion: 1,
    vehicles: [seedVehicle()],
    recordings,
    selectedId: recordings[0]?.id || "",
    customPreference: { zoom: 2 },
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

test("só marca como sintético por sinalização explícita ou hash conhecido", () => {
  assert.equal(isSyntheticRecord(null), false);
  assert.equal(isSyntheticRecord({ isDemo: true }), true);
  assert.equal(isSyntheticRecord({ isDemo: "true" }), false);
  assert.equal(
    isSyntheticRecord({ metadata: { operation_mode: "simulation" } }),
    true,
  );
  for (const hash of KNOWN_SYNTHETIC_HASHES) {
    assert.equal(isSyntheticRecord({ metadata: { sha256: hash } }), true);
    assert.equal(
      isSyntheticRecord({ metadata: { sha256: hash.toUpperCase() } }),
      true,
    );
    assert.equal(
      isSyntheticRecord({ metadata: { provenance: { sha256: hash } } }),
      true,
    );
  }
  for (const input of [
    { filename: "strada_sintetica.csv", title: "Demonstração", metadata: {} },
    { metadata: { operation_mode: "real", sha256: "a".repeat(64) } },
    { metadata: { operation_mode: "imported" } },
    { isDemo: false },
  ])
    assert.equal(isSyntheticRecord(input), false);
});

test("preserva medições reais e não verificadas; arquiva apenas exemplos comprovados", () => {
  const input = workspace([
    recording("demo", seedVehicle(), { isDemo: true }),
    recording("real", seedVehicle(), {
      metadata: { operation_mode: "real", sha256: "1".repeat(64) },
    }),
    recording("unverified"),
    recording("old-csv", seedVehicle(), {
      metadata: { sha256: KNOWN_SYNTHETIC_HASHES[0] },
    }),
  ]);
  input.selectedId = "real";
  const before = structuredClone(input);
  deepFreeze(input);
  const result = prepareRealBase(input);
  assert.deepEqual(
    result.state.recordings.map((r) => r.id),
    ["real", "unverified"],
  );
  assert.deepEqual(
    result.archivedRecordings.map((r) => r.id),
    ["demo", "old-csv"],
  );
  assert.equal(result.state.selectedId, "real");
  assert.equal(
    result.archivedVehicles.length,
    0,
    "cadastro segue vinculado a medições ativas",
  );
  assert.deepEqual(result.state.customPreference, before.customPreference);
  assert.deepEqual(input, before, "planejamento não altera o objeto recebido");
  result.archivedRecordings[0].vehicle.model = "Cópia editada";
  assert.equal(input.recordings[0].vehicle.model, "Strada");
});

test("arquiva cadastro padrão só quando vinculado ao exemplo e sem registro ativo", () => {
  const input = workspace();
  const manualTwin = seedVehicle("v-manual");
  input.vehicles.push(manualTwin);
  const result = prepareRealBase(input);
  assert.deepEqual(result.archivedVehicles, [seedVehicle()]);
  assert.deepEqual(result.state.vehicles, [manualTwin]);
  assert.equal(result.state.selectedId, "");
  assert.deepEqual(result.archivedRecordings[0], input.recordings[0]);
  assert.deepEqual(result.archivedRecordings[0].vehicle, input.vehicles[0]);
});

test("ECU identificada ou com campos desconhecidos nunca é presumida como cadastro fictício", () => {
  const changes = [
    { manufacturer: "Magneti Marelli" },
    { identification: "IAW" },
    { hardware: "HW01" },
    { software: "SW01" },
    { source: "Rasther III/S" },
    { calibration: "12345" },
  ];
  for (const change of changes) {
    const input = workspace();
    Object.assign(input.vehicles[0].ecu, change);
    assert.equal(prepareRealBase(input).archivedVehicles.length, 0);
    assert.equal(prepareRealBase(input).state.vehicles.length, 1);
  }
});

test("cadastros diferentes do padrão são preservados mesmo ligados apenas a simulação", () => {
  for (const change of [
    { brand: "Toyota" },
    { model: "Hilux" },
    { year: 2023 },
    { engine: "1.8" },
    { plate: "ABC1D23" },
  ]) {
    const input = workspace();
    Object.assign(input.vehicles[0], change);
    assert.equal(prepareRealBase(input).archivedVehicles.length, 0);
  }
});

test("troca seleção removida pelo primeiro ensaio ativo e preserva seleção ativa", () => {
  const input = workspace([
    recording("removed", seedVehicle(), {
      metadata: { operation_mode: "simulation" },
    }),
    recording("first"),
    recording("second"),
  ]);
  assert.equal(prepareRealBase(input).state.selectedId, "first");
  input.selectedId = "second";
  assert.equal(prepareRealBase(input).state.selectedId, "second");
});

test("planejamento é idempotente e migração neutra não faz I/O nem muda referência", async () => {
  const once = prepareRealBase(workspace()).state;
  const twice = prepareRealBase(once);
  assert.strictEqual(twice.state, once);
  assert.deepEqual(twice.archivedRecordings, []);
  assert.deepEqual(twice.archivedVehicles, []);
  const source = workspace([recording("unverified")]);
  const result = await migrateRealBase(source, {
    archive: () => assert.fail("não deve arquivar"),
    commit: () => assert.fail("não deve gravar"),
  });
  assert.strictEqual(result.state, source);
  assert.equal(result.removedRecordings, 0);
  assert.equal(result.removedVehicles, 0);
});

test("confirma arquivo antes do commit e conserva todas as cópias", async () => {
  const source = workspace();
  const before = structuredClone(source);
  const order = [];
  let savedArchive, savedState;
  const result = await migrateRealBase(source, {
    archive: async (copy) => {
      order.push("archive:start");
      await Promise.resolve();
      savedArchive = copy;
      order.push("archive:complete");
    },
    commit: async (next) => {
      assert.equal(order.at(-1), "archive:complete");
      order.push("commit");
      savedState = next;
    },
  });
  assert.deepEqual(order, ["archive:start", "archive:complete", "commit"]);
  assert.deepEqual(savedArchive.recordings, before.recordings);
  assert.deepEqual(savedArchive.vehicles, before.vehicles);
  assert.strictEqual(result.state, savedState);
  assert.equal(result.removedRecordings, 1);
  assert.equal(result.removedVehicles, 1);
  assert.deepEqual(source, before);
});

test("falha ao arquivar impede commit e preserva a entrada inteira", async () => {
  const source = workspace();
  const before = structuredClone(source);
  await assert.rejects(
    migrateRealBase(source, {
      archive: async () => {
        throw new Error("arquivo indisponível");
      },
      commit: () => assert.fail("commit não autorizado sem cópia"),
    }),
    /arquivo indisponível/,
  );
  assert.deepEqual(source, before);
});

test("falha ao gravar preserva a entrada e mantém arquivo para recuperação", async () => {
  const source = workspace();
  const before = structuredClone(source);
  let archived;
  await assert.rejects(
    migrateRealBase(source, {
      archive: async (copy) => {
        archived = copy;
      },
      commit: async () => {
        throw new Error("conflito entre abas");
      },
    }),
    /conflito entre abas/,
  );
  assert.deepEqual(source, before);
  assert.deepEqual(archived.recordings, source.recordings);
  assert.deepEqual(archived.vehicles, source.vehicles);
});

async function withDatabase(callback) {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try {
    await callback();
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
}

async function readArchive(name, id) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("auto-ecu-lab-legacy-archive", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(name, "readonly");
    const request = transaction.objectStore(name).get(id);
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

test("arquivo padrão IndexedDB contém gravação completa e cadastro antes do commit", async () =>
  withDatabase(async () => {
    const source = workspace();
    await migrateRealBase(source, {
      commit: async (next) => {
        const archived = await readArchive("recordings", "synthetic");
        assert.deepEqual(archived.recording, source.recordings[0]);
        assert.deepEqual(archived.recording.vehicle, source.vehicles[0]);
        assert.deepEqual(
          (await readArchive("vehicles", "v-demo")).vehicle,
          source.vehicles[0],
        );
        assert.deepEqual(next.recordings, []);
      },
    });
  }));

test("arquivo padrão mantém versões distintas com mesmo ID e não duplica repetição igual", async () =>
  withDatabase(async () => {
    const original = workspace();
    const changed = structuredClone(original);
    changed.recordings[0].title = "Título editado antes de nova tentativa";
    const commit = async () => {};
    await migrateRealBase(original, { commit });
    await migrateRealBase(changed, { commit });
    await migrateRealBase(changed, { commit });
    const archived = await readArchive("recordings", "synthetic");
    assert.equal(archived.recording.title, changed.recordings[0].title);
    assert.deepEqual(archived.previous.recording, original.recordings[0]);
    assert.equal(archived.previous.previous, undefined);
  }));

test("erro de quota no arquivo padrão nunca remove a base ativa", async () =>
  withDatabase(async () => {
    const source = workspace();
    const before = structuredClone(source);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    try {
      await assert.rejects(
        migrateRealBase(source, {
          commit: () => assert.fail("não deve gravar após erro de arquivo"),
        }),
        /arquivar.*dados ativos foram preservados/,
      );
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    assert.deepEqual(source, before);
    assert.equal(await readArchive("recordings", "synthetic"), undefined);
  }));

test("sem IndexedDB não descarta exemplos nem grava alteração", async () => {
  const previous = globalThis.indexedDB;
  delete globalThis.indexedDB;
  try {
    await assert.rejects(
      migrateRealBase(workspace(), {
        commit: () => assert.fail("não deve gravar sem arquivo"),
      }),
      /dados ativos foram preservados/,
    );
  } finally {
    if (previous !== undefined) globalThis.indexedDB = previous;
  }
});
