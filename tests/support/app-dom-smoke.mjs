/** Integração de módulos em DOM em memória; não é validação de navegador/hardware. */
import { parseHTML } from "linkedom";
import { indexedDB } from "fake-indexeddb";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { loadState, saveState } from "../../dist/store.mjs";
import { makeDemo } from "../fixtures/demo.mjs";
import { summarizeRecordings } from "../../dist/statistics.mjs";

const scenario = process.argv[2] || "empty";

const html = await readFile(
  new URL("../../dist/index.html", import.meta.url),
  "utf8",
);
const { window } = parseHTML(html);
// Reproduz o setter e o valor implícito da opção, nativos nos navegadores.
const optionValue = (option) =>
  option.hasAttribute("value")
    ? option.getAttribute("value")
    : option.textContent;
Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
  get() {
    const selected =
      [...this.options].find((option) => option.selected) || this.options[0];
    return selected ? optionValue(selected) : "";
  },
  set(value) {
    for (const option of this.options)
      option.selected = optionValue(option) === String(value);
  },
  configurable: true,
});
globalThis.window = window;
globalThis.document = window.document;
globalThis.indexedDB = indexedDB;
const location = {
  hash: "#analise",
  reload() {
    throw new Error("Reload inesperado");
  },
};
globalThis.location = location;
let hardwareRequests = 0;
Object.defineProperty(globalThis, "navigator", {
  value: {
    onLine: true,
    userAgent: "Windows",
    serial: {
      requestPort() {
        hardwareRequests++;
        throw new Error("Hardware não pode abrir automaticamente.");
      },
    },
  },
  configurable: true,
});
globalThis.matchMedia = () => ({ matches: false });
window.scrollTo = () => {};
if (scenario === "legacy") {
  // Exclusivamente fixtures de teste, jamais tratadas como aquisições reais.
  const vehicle = {
    id: "vehicle-test",
    brand: "Fiat",
    model: "Strada",
    year: 2022,
    engine: "1.4",
    plate: "TESTE",
    ecu: { source: "Não confirmada" },
  };
  const recording = (id, isDemo) => ({
    id,
    vehicleId: vehicle.id,
    title: id,
    filename: `${id}.csv`,
    createdAt: "2026-11-06T12:00:00Z",
    isDemo,
    vehicle,
    samples: makeDemo(),
    diagnostics: [],
    metadata: {},
    analysisConfig: {},
  });
  await saveState({
    schemaVersion: 1,
    vehicles: [vehicle],
    recordings: [
      recording("synthetic-test-only", true),
      recording("unverified-test-only", false),
    ],
    selectedId: "synthetic-test-only",
  });
}
await import("../../dist/app.mjs");
const waitUntil = async (condition) => {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `A interface não completou a inicialização: ${document.querySelector("#toast")?.textContent || "sem aviso"}`,
  );
};
await waitUntil(() => document.querySelector("#desktop-nav a"));
assert.equal(document.querySelectorAll("#desktop-nav a").length, 7);
assert.match(document.body.textContent, /Auto Elétrica Doidinho/);
const initial = await loadState();
if (scenario === "legacy") {
  assert.deepEqual(
    initial.recordings.map((record) => record.id),
    ["unverified-test-only"],
  );
  assert.equal(initial.selectedId, "unverified-test-only");
  assert.match(document.body.textContent, /fora das estatísticas/);
  const archive = await new Promise((resolve, reject) => {
    const request = indexedDB.open("auto-ecu-lab-legacy-archive", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const archived = await new Promise((resolve, reject) => {
    const request = archive
      .transaction("recordings")
      .objectStore("recordings")
      .get("synthetic-test-only");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  archive.close();
  assert.equal(archived.recording.isDemo, true);
} else {
  assert.deepEqual(initial, {
    schemaVersion: 1,
    vehicles: [],
    recordings: [],
    selectedId: "",
  });
  assert.match(document.body.textContent, /Seu primeiro ensaio começa aqui/);
  assert.equal(document.querySelector("#signal-chart"), null);
  assert.equal(document.querySelector(".signal-chart"), null);
}
for (const page of [
  "veiculos",
  "importar",
  "simulador",
  "relatorios",
  "conexoes",
  "sistema",
  "base",
]) {
  location.hash = "#" + page;
  window.dispatchEvent(new window.Event("hashchange"));
  assert.ok(document.querySelector("h1"), page);
  if (page === "veiculos") {
    assert.equal(document.querySelectorAll("#vehicle-preset option").length, 8);
    assert.match(document.body.textContent, /Hilux/);
    assert.match(document.body.textContent, /Amarok/);
  }
  if (page === "importar") {
    assert.equal(document.querySelector("#demo-form"), null);
    assert.equal(document.querySelector("[data-example]"), null);
    assert.equal(document.querySelector('[name="isDemo"]'), null);
    if (scenario !== "legacy")
      assert.ok(
        document.querySelector('#import-form button[type="submit"]').disabled,
      );
  }
  if (page === "base") {
    assert.match(
      document.querySelector("h1").textContent,
      /Base real e estatísticas/,
    );
    assert.match(document.body.textContent, /Sem medições reais suficientes/);
    assert.equal(
      document.querySelectorAll(".metrics .metric strong").length,
      4,
    );
    assert.ok(
      [...document.querySelectorAll(".metrics .metric strong")].every(
        (element) => element.textContent === "0",
      ),
    );
    assert.equal(
      document.querySelector("[data-export-statistics]").disabled,
      true,
    );
    if (scenario === "legacy")
      assert.match(document.body.textContent, /unverified-test-only/);
  }
  if (page === "conexoes") {
    assert.equal(
      document.querySelector("#live-status").textContent,
      "Desconectado",
    );
    assert.equal(
      document.querySelector('[data-live-signal="rpm"]').textContent,
      "Não disponível",
    );
  }
  if (page === "sistema") {
    assert.match(document.body.textContent, /O mesmo endereço e o mesmo ícone/);
    assert.ok(document.querySelector("[data-check-updates]"));
    assert.equal(
      document.querySelectorAll("#system-form [name=favorite]").length,
      7,
    );
    assert.equal(document.querySelectorAll(".module-tile").length, 7);
  }
}
assert.equal(hardwareRequests, 0);
if (scenario === "import") {
  // Shim apenas para FormData de DOM em memória; File e SHA-256 continuam nativos.
  const NativeFormData = globalThis.FormData;
  globalThis.FormData = class extends NativeFormData {
    constructor(form) {
      super();
      for (const field of form.querySelectorAll(
        "input[name],select[name],textarea[name]",
      )) {
        if (
          field.disabled ||
          (["checkbox", "radio"].includes(field.type) && !field.checked)
        )
          continue;
        if (field.type === "file") {
          for (const file of field.files || [])
            this.append(field.getAttribute("name"), file);
        } else
          this.append(
            field.getAttribute("name"),
            ["checkbox", "radio"].includes(field.type)
              ? (field.getAttribute("value") ?? "on")
              : (field.value ?? field.options?.[0]?.value ?? ""),
          );
      }
    }
  };
  const visit = (page) => {
    location.hash = `#${page}`;
    window.dispatchEvent(new window.Event("hashchange"));
  };
  const setFields = (form, values) => {
    for (const [name, value] of Object.entries(values)) {
      const field = form.querySelector(`[name="${name}"]`);
      assert.ok(field, name);
      if (field.type === "checkbox") field.checked = value;
      else field.value = value;
    }
  };
  const submit = (form) =>
    form.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
  globalThis.confirm = () => true;
  visit("veiculos");
  const vehicleForm = document.querySelector("#vehicle-form");
  setFields(vehicleForm, {
    brand: "Marca de teste",
    model: "Veículo de teste",
    year: "2022",
    engine: "1.4",
    source: "Não confirmada",
  });
  submit(vehicleForm);
  await waitUntil(async () => (await loadState()).vehicles.length === 1);
  // Arquivo sintético exclusivo deste teste; a confirmação abaixo exercita a UI.
  const signals = new File(
    [
      "tempo_s;pedal_pct;throttle_pct;rpm\n0;0;5;850\n0.1;40;5;850\n0.2;40;35;1200\n0.3;40;35;1200\n",
    ],
    "fixture-ui-only.csv",
    { type: "text/csv" },
  );
  const prepareImport = async (confirmed) => {
    visit("importar");
    const form = document.querySelector("#import-form");
    setFields(form, {
      vehicleId: (await loadState()).vehicles[0].id,
      title: "Fixture apenas de integração",
      sourceName: "Scanner de teste DOM",
      originKind: "scanner_report",
      timeUnit: "s",
      capturedAt: "2026-11-06T08:30",
      captureOffset: "-04:00",
      realDataConfirmed: confirmed,
      time_s_definition: "monotonic_seconds",
      pedal_pct_definition: "OBD-II 01 49 percent",
      throttle_pct_definition: "OBD-II 01 11 percent",
      rpm_definition: "OBD-II 01 0C rpm",
    });
    form.querySelector('[name="signals"]').files = [signals];
    return form;
  };
  const unconfirmed = await prepareImport(false);
  submit(unconfirmed);
  await waitUntil(() => !unconfirmed.inert);
  assert.match(document.querySelector("#toast").textContent, /Confirme/);
  assert.equal((await loadState()).recordings.length, 0);
  unconfirmed.querySelector('[name="realDataConfirmed"]').checked = true;
  unconfirmed.querySelector('[name="capturedAt"]').value = "2026-02-31T10:00";
  submit(unconfirmed);
  await waitUntil(() => !unconfirmed.inert);
  assert.match(
    document.querySelector("#toast").textContent,
    /Data de aquisição inválida/,
  );
  assert.equal((await loadState()).recordings.length, 0);
  unconfirmed.querySelector('[name="capturedAt"]').value = "2026-11-06T08:30";
  submit(unconfirmed);
  await waitUntil(async () => (await loadState()).recordings.length === 1);
  assert.equal(location.hash, "#analise");
  let saved = await loadState();
  assert.equal(
    saved.recordings[0].metadata.provenance.captured_at,
    "2026-11-06T12:30:00.000Z",
  );
  assert.match(saved.recordings[0].metadata.sha256, /^[0-9a-f]{64}$/);
  assert.equal(saved.recordings[0].isDemo, false);
  visit("base");
  assert.deepEqual(
    [...document.querySelectorAll(".metrics .metric strong")].map(
      (element) => element.textContent,
    ),
    ["1", "1", "4", "1"],
  );
  assert.match(document.body.textContent, /DADOS OBSERVADOS/);
  assert.match(
    document.body.textContent,
    /DTC não consultado ou incompleto em 1/,
  );
  assert.ok(!document.querySelector("[data-export-statistics]").disabled);
  const duplicate = await prepareImport(true);
  submit(duplicate);
  await waitUntil(async () => (await loadState()).recordings.length === 2);
  saved = await loadState();
  const stats = summarizeRecordings(saved.recordings);
  assert.equal(stats.totals.sessions, 1);
  assert.equal(stats.totals.samples, 4);
  assert.equal(stats.totals.duplicate_records, 1);
  visit("base");
  assert.deepEqual(
    [...document.querySelectorAll(".metrics .metric strong")].map(
      (element) => element.textContent,
    ),
    ["1", "1", "4", "1"],
  );
  assert.match(document.body.textContent, /1 duplicata/);
  assert.equal(hardwareRequests, 0);
}
// Cancelar uma saída não pode reconstruir o formulário e apagar o rascunho.
location.hash = "#veiculos";
window.dispatchEvent(new window.Event("hashchange"));
const vehicleForm = document.querySelector("#vehicle-form");
vehicleForm.querySelector("[name=model]").value = "RASCUNHO_TESTE";
globalThis.confirm = () => false;
location.hash = "#importar";
window.dispatchEvent(new window.Event("hashchange"));
assert.equal(location.hash, "#veiculos");
window.dispatchEvent(new window.Event("hashchange"));
assert.equal(document.querySelector("#vehicle-form"), vehicleForm);
assert.equal(vehicleForm.querySelector("[name=model]").value, "RASCUNHO_TESTE");
console.log(
  "Oito telas renderizadas, base sem exemplos ativos e zero conexões automáticas.",
);
