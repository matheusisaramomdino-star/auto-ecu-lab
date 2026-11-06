import {
  ANALYSIS_DEFAULTS,
  SIMULATION_DEFAULTS,
  LIMITATIONS,
  analyze,
  simulate,
  parseSignals,
  parseDiagnostics,
  decodeFile,
  csvEncode,
} from "./core.mjs";
import { loadState, saveState, parseBackup, stateJSON } from "./store.mjs";
import {
  escapeHtml,
  reportPayload,
  reportHtml,
  recordingCsv,
  simulationCsv,
} from "./report.mjs";
import { renderSignalChart } from "./chart.mjs";
import { VEHICLES, BRAND } from "./catalog.mjs";
import { operationMode, OPERATION_MODES } from "./modes.mjs";
import { createConnectionController } from "./connections.mjs";
import {
  APP_VERSION,
  APP_MODULES,
  formFingerprint,
  updateSafety,
} from "./modules.mjs";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "./preferences.mjs";
import { createUpdateManager } from "./updates.mjs";
import { migrateRealBase, isSyntheticRecord } from "./real-base.mjs";
import { summarizeRecordings, provenanceStatus } from "./statistics.mjs";

const $ = (selector, parent = document) => parent.querySelector(selector);
const h = escapeHtml;
const n = (value, digits = 0) =>
  value == null
    ? "—"
    : Number(value).toLocaleString("pt-BR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const date = (value) =>
  new Date(value).toLocaleString("pt-BR", { timeZone: "America/Manaus" }) +
  " · Manaus";
const uid = () => crypto.randomUUID();
const navigation = APP_MODULES.filter(
  (module) => module.navigation !== false,
).map((module) => [module.id, module.icon, module.label, module.short]);
const paths = {
  activity: "M3 12h4l3-8 4 16 3-8h4",
  car: "m5 8 2-4h10l2 4 2 2v8H3v-8l2-2Zm0 0h14M3 13h18M5 18v2m14-2v2M6 10h1m10 0h1",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  sliders:
    "M5 3v4m0 4v10m7-18v10m0 4v4m7-18v4m0 4v10M2 7h6v4H2V7Zm7 6h6v4H9v-4Zm7-6h6v4h-6V7Z",
  file: "M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8m-8 4h5",
  phone:
    "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 15h2M10 6h4",
  plug: "M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v4",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1",
  database:
    "M4 5c0-3 16-3 16 0s-16 3-16 0Zm0 0v14c0 3 16 3 16 0V5M4 12c0 3 16 3 16 0",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.activity}"/></svg>`;
let state;
let activeChart;
let currentSimulation;
let currentSimulationConfig = { ...SIMULATION_DEFAULTS };
let installEvent;
let offlineReady = false;
let toastTimer;
let importVehicleId = "";
let mutationInProgress = false;
let renderedRoute = "";
let preferences = structuredClone(DEFAULT_PREFERENCES);
let preferencesWriting = 0,
  preferenceQueue = Promise.resolve(),
  updateBarrier = false;
const formBaselines = new Map();
let updateState = {
  status: "idle",
  message: "Verificando a versão deste aplicativo.",
  available: false,
  reasons: [],
  release: null,
  locked: false,
};
const liveController = createConnectionController({
  notify: toast,
  download,
  onSave: saveLiveRecording,
  canOperate: () => !updateBarrier,
  onSafetyChange: () => queueMicrotask(() => updater.refreshSafety()),
});
const updater = createUpdateManager({
  isSafe: currentUpdateSafety,
  beforeActivate: async () => {
    await preferenceQueue.catch(() => {});
    if (!currentUpdateSafety().safe) throw new Error("Há operações pendentes.");
  },
  onLock: (locked) => {
    updateBarrier = locked;
    $("#conteudo").inert = locked;
    $("#desktop-nav").inert = locked;
    $("#mobile-nav").inert = locked;
  },
  onState: (value) => {
    updateState = value;
    offlineReady = value.offlineReady;
    updateConnection();
    paintSystemStatus();
  },
});
const SIMULATION_PROFILES = {
  suave: [0.35, 0.6, 1.6, 85],
  linear: [0.15, 0.25, 1, 85],
  rapido: [0.05, 0.1, 0.7, 85],
};

function toast(message, error = false) {
  const element = $("#toast");
  clearTimeout(toastTimer);
  element.textContent = message;
  element.className = `toast${error ? " error" : ""}`;
  element.hidden = false;
  toastTimer = setTimeout(() => (element.hidden = true), error ? 11000 : 6500);
}

function current() {
  return (
    state.recordings.find((recording) => recording.id === state.selectedId) ||
    state.recordings[0]
  );
}
function route() {
  return APP_MODULES.some((module) => module.id === location.hash.slice(1))
    ? location.hash.slice(1)
    : "analise";
}
async function commit(next) {
  await saveState(next);
  state = next;
}
function newRecording(
  vehicle,
  title,
  filename,
  samples,
  isDemo,
  metadata = {},
  diagnostics = [],
) {
  return {
    id: uid(),
    vehicleId: vehicle.id,
    title,
    filename,
    createdAt: new Date().toISOString(),
    isDemo,
    vehicle: structuredClone(vehicle),
    samples,
    diagnostics,
    metadata: {
      ...metadata,
      operation_mode:
        metadata.operation_mode || (isDemo ? "simulation" : "imported"),
    },
    analysisConfig: { ...ANALYSIS_DEFAULTS },
  };
}
function heading(eyebrow, title, description, action = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function empty(
  title,
  description,
  url = "#importar",
  label = "Importar dados",
) {
  return `<section class="panel empty">${icon("activity")}<h2>${title}</h2><p>${description}</p><a class="btn primary" href="${url}">${label}</a></section>`;
}
function picker() {
  return `<div class="selector"><label for="recording-select">Ensaio selecionado</label><select id="recording-select" data-select-recording>${state.recordings.map((r) => `<option value="${h(r.id)}" ${current()?.id === r.id ? "selected" : ""}>${h(r.title)}</option>`).join("")}</select></div>`;
}
function vehicleStrip(recording) {
  const v = recording.vehicle;
  const mode = operationMode(recording);
  return `<section class="vehicle-strip"><span class="round-icon">${icon("car")}</span><div><strong>${h(v.brand)} ${h(v.model)}</strong><small>${v.year} · Motor ${h(v.engine)} · ${h(v.plate || "Sem placa informada")}</small></div><div class="ecu"><span>IDENTIFICAÇÃO DA ECU</span><strong>${h(v.ecu.identification || "Não confirmada")}</strong><small>${h(v.ecu.source || "Não confirmada")}</small></div><span class="badge ${recording.isDemo ? "amber" : ""}">${h(OPERATION_MODES[mode].badge)}</span></section>`;
}
const notice = () =>
  `<p class="notice"><strong>Uma leitura técnica, com contexto.</strong> ${h(LIMITATIONS)}</p>`;
const chartPanel = (simulationMode = false) =>
  `<section class="panel chart-panel"><div class="panel-heading"><div><h2>${simulationMode ? "Comparação de respostas" : "Comportamento dos sinais"}</h2><p>${simulationMode ? "Sinal medido e modelo matemático, lado a lado." : "Pedal, borboleta e rotação ao longo da aquisição."}</p></div><span class="badge">TEMPO × RESPOSTA</span></div><div id="chart"></div></section>`;
function vehicleOptions(selected = "") {
  return state.vehicles
    .map(
      (v) =>
        `<option value="${h(v.id)}" ${v.id === selected ? "selected" : ""}>${h(v.brand)} ${h(v.model)} ${v.year} · ${h(v.plate || v.engine)}</option>`,
    )
    .join("");
}
function reportButtons(id) {
  return ["html", "json", "csv"]
    .map(
      (format) =>
        `<button type="button" class="btn compact subtle" data-export="${format}" data-recording="${h(id)}">${format.toUpperCase()}</button>`,
    )
    .join("");
}

function analysisPage() {
  const r = current();
  let html = heading(
    "DIAGNÓSTICO EXPLORATÓRIO",
    "Análise de resposta",
    "Auto Elétrica Doidinho · análise com origem e contexto, no computador e no celular.",
    `<a class="btn primary" href="#importar">${icon("upload")} Importar CSV</a>`,
  );
  if (!r)
    return (
      html +
      empty(
        "Seu primeiro ensaio começa aqui",
        "Cadastre o veículo e importe medições reais ou faça uma coleta OBD-II. Não há valores de demonstração nesta base.",
        "#veiculos",
        "Cadastrar veículo",
      ) +
      `<div class="panel-link"><a class="text-link" href="#base">Ver base real e estatísticas →</a></div>`
    );
  const result = analyze(r.samples, r.diagnostics, r.analysisConfig);
  const provenance = provenanceStatus(r);
  html += `<section class="panel provenance-banner"><div><strong>${provenance.eligible ? "Origem documentada para análise local" : "Registro fora das estatísticas da base real"}</strong><p>${h(provenance.reason)}</p></div><a class="btn" href="#base">Base e estatísticas</a></section>`;
  html += `<div class="install-banner"><span class="round-icon">${icon("refresh")}</span><div><h2>O mesmo aplicativo. Sempre evoluindo.</h2><p>Novas melhorias chegam aqui, sem outro ícone ou reinstalação.</p></div><a class="btn" href="#sistema">Sistema e atualizações →</a></div>`;
  const shortcuts = preferences.favorites
    .map((id) => APP_MODULES.find((module) => module.id === id))
    .filter(Boolean);
  if (shortcuts.length)
    html += `<section class="quick-modules" aria-label="Seus atalhos">${shortcuts.map((module) => `<a href="#${module.id}" class="quick-module">${icon(module.icon)}<span>${h(module.label)}</span></a>`).join("")}</section>`;
  html += picker() + vehicleStrip(r);
  const metrics = [
    [
      "ATRASO PEDAL → BORBOLETA",
      result.median_throttle_delay_s == null
        ? null
        : result.median_throttle_delay_s * 1000,
      "ms",
      "Mediana das respostas observáveis",
    ],
    [
      "ATRASO PEDAL → RPM",
      result.median_rpm_delay_s == null
        ? null
        : result.median_rpm_delay_s * 1000,
      "ms",
      "Inclui a dinâmica do motor",
    ],
    [
      "ACIONAMENTOS DO PEDAL",
      result.events.length,
      "eventos",
      `Subidas do pedal ≥ ${n(result.config.pedal_rise_pp)} pp`,
    ],
    [
      "INTERVALO DO SCANNER",
      result.interval_s * 1000,
      "ms",
      `${n(result.sample_count)} amostras · ${n(result.duration_s, 1)} s`,
    ],
  ];
  html +=
    `<div class="metrics">${metrics.map(([title, value, unit, sub]) => `<article class="metric"><span>${title}</span><strong>${n(value)} <small>${unit}</small></strong><small>${sub}</small></article>`).join("")}</div>` +
    chartPanel();
  const findings = result.findings.length
    ? result.findings
    : [
        {
          level: "info",
          title: "Sem indícios pelos critérios aplicados",
          evidence:
            "Isso não confirma ausência de falhas. Avalie as condições do ensaio e os DTCs.",
          recommendation:
            "Compare registros equivalentes e consulte o procedimento do fabricante.",
        },
      ];
  html += `<div class="two-col"><section class="panel"><div class="panel-heading"><div><h2>Observações do ensaio</h2><p>Indícios para orientar a investigação.</p></div><span class="counter">${result.findings.length}</span></div><div class="findings">${findings.map((f) => `<article class="finding ${f.level === "info" ? "info" : ""}"><span class="indicator">${f.level === "info" ? "i" : "!"}</span><div><h3>${h(f.title)}</h3><p>${h(f.evidence)}</p><details><summary>Como interpretar</summary><p>${h(f.recommendation)}</p></details></div></article>`).join("")}</div></section><section class="panel"><div class="panel-heading"><div><h2>Atraso por acionamento</h2><p>Tempo até a primeira resposta observável.</p></div></div><div class="table-wrap"><table><thead><tr><th>Evento</th><th>Início</th><th>Borboleta</th><th>RPM</th></tr></thead><tbody>${result.events.map((e, i) => `<tr><td>${i + 1}</td><td>${n(e.time_s, 2)} s</td><td class="${e.throttle_delay_s > result.config.slow_threshold_s ? "amber-text" : ""}">${e.throttle_delay_s == null ? (e.usable ? "Não observada" : "Lacuna") : n(e.throttle_delay_s * 1000) + " ms"}</td><td>${e.rpm_delay_s == null ? "Não observada" : n(e.rpm_delay_s * 1000) + " ms"}</td></tr>`).join("") || '<tr><td colspan="4">Nenhum acionamento pelos critérios atuais.</td></tr>'}</tbody></table></div><p class="panel-footnote">Resolução aproximada: ${n(result.interval_s * 1000)} ms. A aquisição pode ser sequencial entre canais.</p><div class="panel-link"><button type="button" class="text-link" data-export="html" data-recording="${h(r.id)}">Baixar relatório completo ↗</button><a class="text-link" href="#simulador">Simular outra resposta →</a></div></section></div>`;
  const parameters = [
    ["pedal_rise_pp", "Subida do pedal", "pp"],
    ["throttle_rise_pp", "Resposta da borboleta", "pp"],
    ["rpm_rise", "Resposta do motor", "RPM"],
    ["response_window_s", "Janela máxima", "s"],
    ["slow_threshold_s", "Limite de demora", "s"],
  ];
  html += `<section class="panel settings"><details><summary>Critérios da análise<span>Limiares exploratórios, ajustáveis por ensaio</span></summary><form id="analysis-form"><div class="form-grid five">${parameters.map(([key, label, unit]) => `<label>${label} (${unit})<input name="${key}" type="number" step="any" min="0.001" value="${result.config[key]}" required></label>`).join("")}</div><button type="submit" class="btn primary">Recalcular análise</button></form></details></section>`;
  html += `<section class="panel settings"><details><summary>DTCs e origem dos dados<span>${h(r.filename)}</span></summary><p class="notice">Importação: ${h(date(r.createdAt))}<br>ECU: ${h(r.vehicle.ecu.manufacturer || "Fabricante não informado")} · HW ${h(r.vehicle.ecu.hardware || "—")} · SW ${h(r.vehicle.ecu.software || "—")}<br>SHA-256: <span style="overflow-wrap:anywhere">${h(r.metadata.sha256 || "Não disponível — reimporte o arquivo original para documentar a origem")}</span></p><form id="dtc-form"><label>Associar ou substituir relatório DTC CSV<input type="file" name="diagnostics" accept=".csv,text/csv" required><small>Colunas: codigo;descricao;status. A validação acontece antes de substituir.</small></label><button type="submit" class="btn">Associar relatório</button></form></details></section>`;
  if (!provenance.eligible) {
    html += `<section class="panel"><div class="panel-heading"><div><h2>Revisar origem do registro</h2><p>Registros antigos são preservados, mas não entram nas estatísticas sem documentação.</p></div></div>${/^[a-f0-9]{64}$/i.test(r.metadata.sha256 || "") ? `<form id="provenance-form" class="padded-form">${provenanceFields(r)}<button type="submit" class="btn primary">Documentar origem real</button></form>` : `<div class="system-content"><p>O hash do arquivo original não está disponível. Reimporte o CSV original com a fonte e a data corretas.</p><a class="btn" href="#importar">Reimportar arquivo original</a></div>`}</section>`;
  }
  return html + notice();
}

function vehiclesPage() {
  const ecuFields = [
    ["manufacturer", "Fabricante da central"],
    ["identification", "Identificação / número da peça"],
    ["hardware", "Hardware (HW)"],
    ["software", "Software (SW)"],
  ];
  return (
    heading(
      "BIBLIOTECA DO LABORATÓRIO",
      "Veículos e ECU",
      "Cadastre o veículo e registre a identificação informada pelo scanner.",
      `<span class="badge">${state.vehicles.length} CADASTRO(S)</span>`,
    ) +
    `<div class="two-col"><section class="panel"><div class="panel-heading"><div><h2>Novo veículo</h2><p>A identificação real da central vem do scanner.</p></div></div><form id="vehicle-form" class="padded-form"><label>Veículo de referência<select id="vehicle-preset"><option value="">Cadastro livre</option>${VEHICLES.map((v) => `<option value="${h(v.key)}" ${v.key === "strada-2022-14" ? "selected" : ""}>${h(v.label)}</option>`).join("")}</select><small>Confirme ano e motor. O catálogo não identifica a ECU nem certifica cobertura do scanner.</small></label><div class="form-grid"><label>Marca<input name="brand" value="Fiat" maxlength="200" required></label><label>Modelo<input name="model" value="Strada" maxlength="200" required></label><label>Ano<input name="year" type="number" value="2022" min="1900" max="2100" required></label><label>Motorização<input name="engine" value="1.4" maxlength="200" required></label><label class="full">Placa ou identificação interna<input name="plate" placeholder="Opcional" maxlength="200"></label></div><div class="form-divider"><h3>Identificação da ECU</h3><p>Não inferimos a família da ECU pelo modelo do veículo. Deixe como não confirmada quando não tiver os dados.</p></div><div class="form-grid">${ecuFields.map(([key, label]) => `<label>${label}<input name="${key}" maxlength="200" placeholder="${key === "identification" ? "Não confirmada" : "Conforme o scanner"}"></label>`).join("")}<label class="full">Origem da identificação<select name="source">${["Não confirmada", "Informada no Rasther III/S", "Etiqueta da ECU", "Documentação do veículo"].map((v) => `<option>${v}</option>`).join("")}</select></label></div><button type="submit" class="btn primary">Cadastrar veículo e ECU</button></form></section><div>${state.vehicles.map((v) => `<article class="panel vehicle-card"><div class="vehicle-card-head"><span class="round-icon">${icon("car")}</span><div><h2>${h(v.brand)} ${h(v.model)}</h2><p>${v.year} · Motor ${h(v.engine)}</p></div></div><dl><div><dt>Identificação</dt><dd>${h(v.plate || "Não informada")}</dd></div><div><dt>ECU</dt><dd>${h(v.ecu.identification || "Não confirmada")}</dd></div><div><dt>Origem</dt><dd>${h(v.ecu.source)}</dd></div><div><dt>HW / SW</dt><dd>${h(v.ecu.hardware || "—")} / ${h(v.ecu.software || "—")}</dd></div></dl><button type="button" class="text-link" data-import-vehicle="${h(v.id)}">Importar dados deste veículo →</button></article>`).join("")}</div></div>`
  );
}

function provenanceFields(recording) {
  const origin = recording?.metadata?.provenance || {};
  return `<div class="form-divider"><h3>Origem da medição</h3><p>Informe a aquisição original, não a data da importação. A confirmação é sua declaração; não representa certificação do scanner.</p></div><div class="form-grid"><label class="full">Tipo de origem<select name="originKind"><option value="scanner_report">Arquivo de scanner / aquisição própria</option><option value="repository_dataset" ${origin.kind === "repository_dataset" ? "selected" : ""}>Dataset documentado de repositório</option></select></label><label class="full">Scanner e origem do registro<input name="sourceName" maxlength="200" placeholder="Nome do scanner e responsável pela aquisição" value="${h(origin.source || "")}" required></label><label>Data e hora da aquisição<input name="capturedAt" type="datetime-local" step="1" required></label><label>Fuso da aquisição<select name="captureOffset"><option value="-04:00">UTC−04 · Manaus</option><option value="-03:00">UTC−03 · Brasília</option><option value="Z">UTC</option></select></label></div><details class="mapping"><summary>Origem em repositório (se aplicável)</summary><div class="form-grid"><label class="full">URL HTTPS do arquivo ou repositório<input name="repositoryUrl" type="url" maxlength="500" value="${h(origin.repository_url || "")}"></label><label class="full">Commit completo (40 caracteres)<input name="repositoryRevision" maxlength="40" value="${h(origin.revision || "")}"></label><label class="full">Licença do dataset<input name="dataLicense" maxlength="200" value="${h(origin.license || "")}"></label></div><p>O código de um scanner, uma lista de PIDs ou um README não constituem medições de um veículo.</p></details><details class="mapping"><summary>Definições documentadas dos sinais (opcional)</summary><p>Informe a definição ou PID exato de cada canal conforme a documentação da aquisição. Sem as quatro definições, o registro terá estatísticas próprias e não será combinado com outros arquivos.</p><div class="form-grid">${[
    ["time_s", "Tempo e referência"],
    ["pedal_pct", "Posição do pedal"],
    ["throttle_pct", "Abertura da borboleta"],
    ["rpm", "Rotação do motor"],
  ]
    .map(
      ([key, label]) =>
        `<label>${label}<input name="${key}_definition" maxlength="200" value="${h(recording?.metadata?.signal_definitions?.[key] || "")}" placeholder="Conforme a documentação da fonte"></label>`,
    )
    .join(
      "",
    )}</div></details><label class="checkbox-label"><input name="realDataConfirmed" type="checkbox" required>Confirmo que são medições reais da origem e data informadas, sem simulação ou exemplos.</label>`;
}
function sourceDefinitions(data) {
  const values = Object.fromEntries(
    ["time_s", "pedal_pct", "throttle_pct", "rpm"].map((key) => [
      key,
      String(data.get(key + "_definition") || "").trim(),
    ]),
  );
  if (Object.values(values).every((value) => !value)) return null;
  if (Object.values(values).some((value) => !value || value.length > 200))
    throw new Error(
      "Documente os quatro sinais ou deixe todas as definições em branco.",
    );
  return values;
}
function importsPage() {
  return (
    heading(
      "ENTRADA DE MEDIÇÕES REAIS",
      "Do scanner ao laboratório",
      "Selecione o arquivo original e documente sua origem. Os dados ficam neste aparelho.",
      `<a class="btn" href="#base">Base real e estatísticas</a>`,
    ) +
    (!state.vehicles.length
      ? `<section class="panel provenance-banner"><div><strong>Cadastre o veículo primeiro</strong><p>Cada aquisição precisa estar vinculada a um veículo real. A identificação da ECU pode permanecer não confirmada.</p></div><a class="btn primary" href="#veiculos">Cadastrar veículo</a></section>`
      : "") +
    `<div class="two-col"><section class="panel"><div class="panel-heading"><div><h2>Importar aquisição real</h2><p>Arquivo CSV de até 5 MB. O SHA-256 é calculado sobre o arquivo original.</p></div></div><form id="import-form" class="padded-form"><div class="form-grid"><label class="full">Veículo<select name="vehicleId" required>${vehicleOptions(current()?.vehicleId)}</select></label><label class="full">Nome do ensaio<input name="title" maxlength="150" placeholder="Descreva as condições da aquisição"></label></div><div class="file-zone">${icon("upload")}<strong>Selecione o CSV de parâmetros</strong><p>Tempo, posição do pedal, abertura da borboleta e RPM.</p><input name="signals" aria-label="Arquivo CSV de parâmetros" type="file" accept=".csv,text/csv" required></div><details class="mapping"><summary>Mapear colunas e unidade de tempo</summary><p>Se o cabeçalho não for reconhecido, digite o nome exato. Pedal e borboleta devem estar em porcentagem; não convertemos tensão ou ângulo.</p><div class="form-grid">${[
      ["time_s", "Coluna de tempo"],
      ["pedal_pct", "Coluna de pedal"],
      ["throttle_pct", "Coluna de borboleta"],
      ["rpm", "Coluna de RPM"],
    ]
      .map(
        ([name, label]) =>
          `<label>${label}<input name="${name}" placeholder="Automático"></label>`,
      )
      .join(
        "",
      )}<label class="full">Unidade do tempo<select name="timeUnit"><option value="auto">Automática (segundos / cabeçalho ms)</option><option value="s">Segundos</option><option value="ms">Milissegundos</option></select></label></div></details><label>Relatório DTC da aquisição (opcional)<input name="diagnostics" type="file" accept=".csv,text/csv"><small>Colunas: codigo;descricao;status. Sem relatório, o estado DTC fica desconhecido.</small></label>${provenanceFields()}<button type="submit" class="btn primary" ${!state.vehicles.length ? "disabled" : ""}>Validar origem e importar</button></form></section><div><section class="panel help-panel"><h2>Base vazia até receber medições</h2><p>Não distribuímos ensaios fictícios nem estatísticas preenchidas. Simulações matemáticas continuam disponíveis após importar ou coletar sinais e ficam fora da base estatística.</p><a class="text-link" href="#conexoes">Fazer coleta OBD-II →</a></section><section class="panel help-panel"><h2>Formato dos canais</h2><pre>tempo_s;pedal_pct;throttle_pct;rpm</pre><p>UTF-8 ou Windows-1252. Ponto e vírgula, vírgula ou tabulação. Tempo crescente, sem duplicatas, até 50.000 amostras. Os quatro canais são obrigatórios; valores ausentes não são inventados.</p><p>A compatibilidade de uma exportação Rasther III/S depende da validação de seu formato documentado. J2534 e outros scanners exigem a integração autorizada correspondente.</p><p>Se os canais não tiverem a mesma definição, condição de ensaio ou ECU, os números não devem ser comparados como referência de funcionamento.</p></section></div></div>`
  );
}

function simulatorPage() {
  const r = current();
  let html = heading(
    "EXPERIMENTAÇÃO VIRTUAL",
    "Simulador de resposta",
    "Explore diferentes curvas sem alterar os dados medidos ou a central.",
    `<span class="badge">APENAS MATEMÁTICA</span>`,
  );
  if (!r)
    return (
      html +
      empty(
        "Importe um ensaio para simular",
        "O modelo usa os dados do pedal como entrada.",
      )
    );
  const fields = [
    ["delay_s", "Atraso puro", 0, 3, 0.05, "s"],
    ["tau_s", "Constante de tempo", 0.02, 3, 0.01, "s"],
    ["gamma", "Expoente da curva", 0.3, 3, 0.1, ""],
    ["maximum_pct", "Abertura máxima", 1, 100, 1, "%"],
  ];
  html +=
    picker() +
    vehicleStrip(r) +
    `<div class="simulation-layout"><section class="panel simulation-settings"><div class="panel-heading"><div><h2>Seu modelo de resposta</h2><p>Ajuste, compare e exporte.</p></div></div><form id="simulation-form"><label>Perfil de estudo<select id="simulation-preset"><option value="custom">Personalizado</option><option value="suave">Progressivo</option><option value="linear" selected>Linear</option><option value="rapido">Resposta rápida</option></select></label>${fields.map(([key, label, min, max, step, unit]) => `<label>${label}<span class="range-value"><output for="${key}">${n(currentSimulationConfig[key], 2)}</output> ${unit}</span><input id="${key}" name="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${currentSimulationConfig[key]}"></label>`).join("")}<button type="submit" class="btn primary">Comparar resposta</button><button type="button" class="btn" data-download-simulation>Baixar simulação CSV</button><p id="simulation-status" role="status">Simulação didática com dados separados do registro original.</p></form></section><div>${chartPanel(true)}<div class="model-note"><strong>Como o modelo funciona</strong><p>Alvo = abertura máxima × (pedal / 100)<sup>expoente</sup>. O atraso puro e um filtro de primeira ordem definem a transição.</p>O modelo não foi calibrado para a ECU e não estima torque, RPM, emissões ou desempenho real.</div></div></div>`;
  return html;
}

function reportsPage() {
  return (
    heading(
      "RESULTADOS E RASTREABILIDADE",
      "Relatórios e backup",
      "Exporte os resultados ou leve seus ensaios para outro dispositivo.",
    ) +
    `<section class="panel"><div class="panel-heading"><div><h2>Histórico deste aparelho</h2><p>HTML com gráfico para imprimir em PDF, JSON com análise e CSV com sinais.</p></div><span class="counter">${state.recordings.length}</span></div><div class="table-wrap"><table><thead><tr><th>Ensaio</th><th>Veículo</th><th>Origem</th><th>Exportar</th></tr></thead><tbody>${state.recordings.map((r) => `<tr><td><button type="button" class="text-link" data-open-recording="${h(r.id)}">${h(r.title)}</button><small class="table-small">${h(date(r.createdAt))}</small></td><td>${h(r.vehicle.brand)} ${h(r.vehicle.model)}<small class="table-small">${r.vehicle.year} · ${h(r.vehicle.engine)}</small></td><td><span class="badge ${r.isDemo ? "amber" : ""}">${h(OPERATION_MODES[operationMode(r)].badge)}</span></td><td><div class="report-actions">${reportButtons(r.id)}</div></td></tr>`).join("") || '<tr><td colspan="4">Nenhum ensaio importado.</td></tr>'}</tbody></table></div></section><section class="panel backup-panel"><div><h2>Seus dados, com você.</h2><p>Os ensaios ficam no armazenamento deste navegador, sem sincronização automática. Salve um backup antes de limpar dados do navegador, reinstalar o app ou trocar de celular. O backup pode conter a placa e a identificação da ECU.</p></div><div class="backup-actions"><button type="button" class="btn primary" data-backup>Baixar backup JSON</button><label class="btn file-button">Restaurar backup<input type="file" id="restore-backup" accept=".json,application/json" aria-label="Restaurar backup JSON"></label></div></section><section class="panel backup-panel"><div><h2>Continue no mesmo aplicativo.</h2><p>As melhorias chegam ao mesmo endereço e ao ícone já instalado. A instalação só é necessária para acrescentar o app em outro aparelho. O componente Python e os drivers são atualizados separadamente.</p></div><div class="backup-actions"><button class="btn" type="button" data-install>Instalar em outro aparelho</button><a class="btn subtle" href="./downloads/AUTO_ECU_LAB_Python.zip" download>Baixar projeto Python</a></div></section>` +
    notice()
  );
}

function basePage() {
  const stats = summarizeRecordings(state.recordings),
    t = stats.totals;
  const metric = (label, value, detail) =>
    `<article class="metric"><span>${label}</span><strong>${n(value)}</strong><small>${detail}</small></article>`;
  return (
    heading(
      "ORIGEM DOCUMENTADA · SEM EXEMPLOS",
      "Base real e estatísticas",
      "Resultados descritivos calculados somente a partir das medições elegíveis deste aparelho.",
      `<a class="btn primary" href="#importar">Importar medições reais</a>`,
    ) +
    `<div class="metrics">${metric("SESSÕES ELEGÍVEIS", t.sessions, "Após validar origem e retirar duplicatas")}${metric("VEÍCULOS COM DADOS", t.vehicles, "Cadastros vinculados às sessões elegíveis")}${metric("AMOSTRAS ELEGÍVEIS", t.samples, "Tempo, pedal, borboleta e RPM válidos")}${metric("GRUPOS COMPARÁVEIS", t.cohorts, "ECU, sinais e critérios compatíveis")}</div>` +
    (!t.sessions
      ? `<section class="panel empty">${icon("database")}<h2>Sem medições reais suficientes</h2><p>Nenhum valor foi preenchido com exemplos, simulações ou médias do mercado.<br>Cadastre o veículo e importe dados de uma aquisição real, ou faça uma coleta OBD-II.</p><a class="btn primary" href="#veiculos">Cadastrar veículo</a> <a class="btn" href="#conexoes">Coletar do scanner</a></section>`
      : "") +
    stats.cohorts
      .map(
        (cohort) =>
          `<section class="panel cohort-panel"><div class="panel-heading"><div><h2>${h(cohort.label)}</h2><p>${cohort.sessions} sessão(ões) · ${n(cohort.samples)} amostras · ${n(cohort.duration_s, 2)} s registrados</p></div><span class="badge">DADOS OBSERVADOS</span></div><div class="table-wrap"><table><thead><tr><th>Medida</th><th>Observações</th><th>Mediana</th><th>p95</th><th>Não observada</th></tr></thead><tbody>${[
            ["Pedal → borboleta", cohort.throttle_delay],
            ["Pedal → RPM", cohort.rpm_delay],
          ]
            .map(
              ([label, value]) =>
                `<tr><td>${label}</td><td>${value.observed}</td><td>${value.median_s == null ? "Sem dados" : n(value.median_s * 1000) + " ms"}</td><td>${value.p95_s == null ? "Sem dados" : n(value.p95_s * 1000) + " ms"}</td><td>${value.missing}</td></tr>`,
            )
            .join(
              "",
            )}</tbody></table></div><div class="cohort-details"><p>Intervalo mediano de aquisição: ${n(cohort.acquisition.median_interval_s * 1000, 1)} ms. Eventos com lacuna: ${cohort.events.excluded_gaps}. DTC não consultado ou incompleto em ${cohort.dtc.unknown_sessions} sessão(ões).</p><p>Faixas observadas: pedal ${n(cohort.signals.pedal_pct.min, 1)}–${n(cohort.signals.pedal_pct.max, 1)}%; borboleta ${n(cohort.signals.throttle_pct.min, 1)}–${n(cohort.signals.throttle_pct.max, 1)}%; RPM ${n(cohort.signals.rpm.min)}–${n(cohort.signals.rpm.max)}.</p><details><summary>Critérios e origem do grupo</summary><p>ECU: ${h(cohort.identity.ecu_id || "Não confirmada; comparação limitada ao veículo")} · HW ${h(cohort.identity.hardware || "não informado")} · SW ${h(cohort.identity.software || "não informado")}.</p><p>${cohort.identity.isolated_recording ? "Definições de sinais ausentes: o arquivo fica em grupo próprio." : "Definições de sinais documentadas."}</p><p>Limiares: pedal ${n(cohort.identity.analysis_config.pedal_rise_pp, 1)} pp; borboleta ${n(cohort.identity.analysis_config.throttle_rise_pp, 1)} pp; RPM ${n(cohort.identity.analysis_config.rpm_rise)}; janela ${n(cohort.identity.analysis_config.response_window_s, 2)} s.</p></details></div></section>`,
      )
      .join("") +
    `<section class="panel cohort-panel"><div class="panel-heading"><div><h2>Rastreabilidade da base</h2><p>${t.received_records} registro(s) ativos recebidos · ${t.excluded_records} fora das estatísticas · ${t.duplicate_records} duplicata(s).</p></div><button type="button" class="btn" data-export-statistics ${!t.sessions ? "disabled" : ""}>Exportar estatísticas JSON</button></div><div class="table-wrap"><table><thead><tr><th>Registro</th><th>Estado de origem</th><th>Ação</th></tr></thead><tbody>${
      state.recordings
        .map((record) => {
          const status = provenanceStatus(record),
            excluded = stats.excluded.find((item) => item.id === record.id);
          return `<tr><td>${h(record.title)}<small class="table-small">${h(record.metadata.provenance?.source || record.metadata.source || "Fonte não informada")}</small></td><td class="wrappable-cell">${h(excluded?.reason || status.reason)}</td><td><button type="button" class="text-link" data-open-recording="${h(record.id)}">${status.eligible ? "Abrir registro" : "Revisar origem"}</button></td></tr>`;
        })
        .join("") ||
      '<tr><td colspan="3">A base começa vazia. Importe ou colete uma medição para iniciar.</td></tr>'
    }</tbody></table></div></section>` +
    `<section class="panel help-panel"><h2>Fontes disponíveis</h2><p>Foi inspecionado o repositório <a class="text-link" href="https://github.com/matheusisaramomdino-star/auto-ecu-lab" target="_blank" rel="noopener noreferrer">matheusisaramomdino-star/auto-ecu-lab</a>, revisão <code>3cd65267552d35051754381fa0df576ea2cb8095</code>. Ele contém um README de objetivos, sem arquivos de aquisição. Nenhuma medição ou estatística foi importada dessa origem.</p><p>Datasets de outros repositórios precisam de arquivo original, fonte, data da coleta, licença e revisão identificadas. Não usamos descrições de código ou tabelas de PIDs como estatísticas de veículos.</p></section><p class="notice"><strong>Limites da leitura.</strong> p95 usa o posto mais próximo; ausência de resposta não é atraso zero. Medianas consideram respostas observadas e devem ser lidas junto dos casos ausentes. Estes dados descrevem a base local e não são especificações OEM, incidência de falhas da frota ou certificação externa. Fonte declarada e hash não provam sozinhos que uma aquisição foi real. Os arquivos de diagnóstico não são publicados no site.</p>`
  );
}

function sourceDate(data) {
  const local = String(data.get("capturedAt") || "").trim(),
    offset = String(data.get("captureOffset") || "-04:00");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local) ||
    !["-04:00", "-03:00", "Z"].includes(offset)
  )
    throw new Error("Informe a data/hora real da aquisição e o fuso.");
  const parsed = new Date(local + (local.length === 16 ? ":00" : "") + offset);
  const shifted = new Date(
    parsed.valueOf() +
      (offset === "Z"
        ? 0
        : Number(offset.slice(0, 3)) * 3600000 +
          Number(offset.slice(4)) * 60000),
  );
  if (
    !Number.isFinite(parsed.valueOf()) ||
    shifted.toISOString().slice(0, 19) !==
      local + (local.length === 16 ? ":00" : "")
  )
    throw new Error("Data de aquisição inválida.");
  return parsed.toISOString();
}
function declaredSource(data, { reference, sha256 }) {
  if (data.get("realDataConfirmed") !== "on")
    throw new Error(
      "Confirme que o arquivo contém medições reais, sem simulação ou demonstração.",
    );
  const kind =
    data.get("originKind") === "repository_dataset"
      ? "repository_dataset"
      : "scanner_report";
  const value = {
    schema_version: 1,
    kind,
    source: requiredText(data, "sourceName"),
    captured_at: sourceDate(data),
    reference,
    sha256,
    verification:
      kind === "repository_dataset"
        ? "documented_dataset"
        : "operator_confirmed",
  };
  if (kind === "repository_dataset") {
    value.repository_url = requiredText(data, "repositoryUrl", 500);
    value.revision = requiredText(data, "repositoryRevision", 40);
    value.license = requiredText(data, "dataLicense", 200);
  }
  return value;
}

function currentUpdateSafety() {
  const dirtyForms = [...formBaselines].some(
    ([form, baseline]) =>
      form.isConnected && formFingerprint(form) !== baseline,
  );
  return updateSafety({
    writing: mutationInProgress,
    preferencesWriting: preferencesWriting > 0,
    session: liveController.hasSession,
    collecting: liveController.isCollecting,
    hardwareBusy: liveController.isBusy,
    unsavedSession: liveController.hasUnsavedData,
    dirtyForms,
  });
}
function captureForms() {
  formBaselines.clear();
  for (const form of $("#conteudo").querySelectorAll("form"))
    formBaselines.set(form, formFingerprint(form));
}
async function persistPreferences(patch) {
  preferencesWriting++;
  preferenceQueue = preferenceQueue
    .catch(() => {})
    .then(async () => {
      preferences = await savePreferences({ ...preferences, ...patch });
      updater.setAutomatic(preferences.automaticUpdates);
      return preferences;
    });
  try {
    return await preferenceQueue;
  } finally {
    preferencesWriting--;
    queueMicrotask(() => updater.refreshSafety());
  }
}
function paintSystemStatus() {
  $("#app-version").textContent = "v" + APP_VERSION;
  const message = $("#system-update-message");
  if (message) message.textContent = updateState.message;
  const reasons = $("#system-update-reasons");
  if (reasons) reasons.textContent = (updateState.reasons || []).join(" ");
  const remote = $("#system-available-version");
  if (remote)
    remote.textContent =
      updateState.release?.version || "Verifique com internet";
  for (const button of document.querySelectorAll("[data-check-updates]"))
    button.disabled = updateState.checking || updateState.locked;
  for (const button of document.querySelectorAll("[data-apply-update]"))
    button.disabled =
      updateState.locked ||
      (!updateState.available && !updateState.pendingReload) ||
      !currentUpdateSafety().safe;
  const banner = $("#update-banner");
  banner.hidden =
    !updateState.available && !updateState.pendingReload && !updateState.locked;
  $("#update-banner-message").textContent =
    updateState.message +
    (updateState.reasons?.length ? " " + updateState.reasons.join(" ") : "");
  $("#activate-update").disabled =
    updateState.locked ||
    (!updateState.available && !updateState.pendingReload) ||
    !currentUpdateSafety().safe;
  $("#activate-update").textContent = updateState.locked
    ? "Atualizando…"
    : "Aplicar atualização";
}
function systemPage() {
  return (
    heading(
      "O MESMO APLICATIVO · SEM REINSTALAR",
      "Sistema e atualizações",
      "As melhorias chegam neste endereço e no ícone que você já usa.",
      `<span class="badge">VERSÃO ${APP_VERSION}</span>`,
    ) +
    `<section class="panel system-version"><div class="panel-heading"><div><h2>Seu aplicativo continua aqui.</h2><p>Quando estiver conectado, verificamos novas versões ao abrir, voltar ao app e periodicamente.</p></div>${icon("refresh")}</div><div class="system-content"><dl class="version-details"><div><dt>Versão em uso</dt><dd>${APP_VERSION}</dd></div><div><dt>Publicação encontrada</dt><dd id="system-available-version">${h(updateState.release?.version || "Verifique com internet")}</dd></div><div><dt>Instalação</dt><dd>O mesmo endereço e o mesmo ícone</dd></div></dl><p id="system-update-message" role="status">${h(updateState.message)}</p><p id="system-update-reasons" class="notice">${h((updateState.reasons || []).join(" "))}</p><div class="system-actions"><button class="btn primary" type="button" data-check-updates>Verificar agora</button><button class="btn" type="button" data-apply-update>Aplicar versão pronta</button></div><p class="notice">Uma versão nova aguarda o fim de coletas, conexões, salvamentos e formulários não salvos. Outras abas também precisam estar prontas. Sem internet, continua a versão já preparada.</p></div></section>` +
    `<div class="two-col system-columns"><section class="panel"><div class="panel-heading"><div><h2>Preferências deste aparelho</h2><p>Personalize o painel sem acrescentar outro aplicativo.</p></div></div><form id="system-form" class="padded-form"><label class="checkbox-label"><input type="checkbox" name="automaticUpdates" ${preferences.automaticUpdates ? "checked" : ""}>Aplicar novas versões automaticamente quando o aplicativo estiver livre</label><h3>Atalhos no painel inicial</h3><div class="module-options">${APP_MODULES.filter(
      (module) => module.id !== "sistema",
    )
      .map(
        (module) =>
          `<label class="checkbox-label"><input type="checkbox" name="favorite" value="${module.id}" ${preferences.favorites.includes(module.id) ? "checked" : ""}>${h(module.label)}</label>`,
      )
      .join(
        "",
      )}</div><button class="btn primary" type="submit">Salvar preferências</button><p class="notice">Atalhos, política de atualização e parâmetros comparados do simulador ficam neste aparelho. Os ensaios e o backup de diagnóstico permanecem separados dessas preferências.</p></form></section><section class="panel"><div class="panel-heading"><div><h2>Melhorias desta versão</h2><p>Versão ${APP_VERSION} · evolução do código existente.</p></div></div><div class="system-content"><ul class="release-notes"><li>Base operacional vazia até receber medições reais.</li><li>Origem, data de aquisição e SHA-256 documentados na importação.</li><li>Estatísticas por grupos comparáveis, com duplicatas e ausências explícitas.</li><li>Exemplos antigos arquivados no aparelho; atualização pelo mesmo ícone.</li></ul><p class="notice">A organização foi comparada com recursos públicos de ferramentas de diagnóstico. Os protocolos proprietários e os limites de integração continuam respeitados; nenhuma atualização habilita gravação na ECU.</p></div></section></div>` +
    `<section class="panel"><div class="panel-heading"><div><h2>Módulos do laboratório</h2><p>As ferramentas evoluem por atualização do site, mantendo seus registros locais.</p></div></div><div class="module-catalog">${APP_MODULES.filter(
      (module) => module.id !== "sistema",
    )
      .map(
        (module) =>
          `<a class="module-tile" href="#${module.id}">${icon(module.icon)}<h3>${h(module.label)}</h3><p>${h(module.description)}</p></a>`,
      )
      .join("")}</div></section>`
  );
}

function render() {
  activeChart?.destroy?.();
  activeChart = null;
  const selected = route();
  if (renderedRoute === "conexoes" && selected !== "conexoes")
    liveController.leave();
  renderedRoute = selected;
  const pages = {
    analise: analysisPage,
    conexoes: () => liveController.page(state.vehicles, current()?.vehicleId),
    veiculos: vehiclesPage,
    importar: importsPage,
    simulador: simulatorPage,
    relatorios: reportsPage,
    base: basePage,
    sistema: systemPage,
  };
  for (const [element, mobile] of [
    [$("#desktop-nav"), false],
    [$("#mobile-nav"), true],
  ])
    element.innerHTML = navigation
      .map(
        ([key, name, label, short]) =>
          `<a href="#${key}" class="${mobile ? "" : "nav-item "}${(selected === "base" ? "analise" : selected) === key ? "active" : ""}" ${(selected === "base" ? "analise" : selected) === key ? 'aria-current="page"' : ""}>${icon(name)}<span>${mobile ? short : label}</span></a>`,
      )
      .join("");
  $("#breadcrumb").textContent = APP_MODULES.find(
    (module) => module.id === selected,
  ).label;
  $("#conteudo").innerHTML = pages[selected]();
  if (selected === "conexoes")
    liveController.bind($("#conteudo"), state.vehicles);
  $("#vehicle-preset")?.addEventListener("change", (event) => {
    const preset = VEHICLES.find(
      (vehicle) => vehicle.key === event.target.value,
    );
    if (!preset) return;
    const form = $("#vehicle-form");
    for (const field of ["brand", "model", "year", "engine"])
      form.elements[field].value = preset[field] ?? "";
    for (const field of [
      "manufacturer",
      "identification",
      "hardware",
      "software",
    ])
      form.elements[field].value = "";
    form.elements.source.value = "Não confirmada";
  });
  if (selected === "importar" && importVehicleId)
    $('#import-form select[name="vehicleId"]').value = importVehicleId;
  const r = current();
  if ($("#chart") && r) {
    activeChart = renderSignalChart($("#chart"), r.samples, {
      events:
        selected === "analise"
          ? analyze(r.samples, r.diagnostics, r.analysisConfig).events
          : [],
      simulationMode: selected === "simulador",
    });
    if (selected === "simulador") updateSimulation();
  }
  $("#simulation-preset")?.addEventListener("change", async (event) => {
    if (!SIMULATION_PROFILES[event.target.value]) return;
    ["delay_s", "tau_s", "gamma", "maximum_pct"].forEach(
      (key, index) =>
        ($("#" + key).value = SIMULATION_PROFILES[event.target.value][index]),
    );
    updateRangeOutputs();
    updateSimulation();
    const form = $("#simulation-form"),
      fingerprint = formFingerprint(form),
      simulation = { ...currentSimulationConfig };
    try {
      await persistPreferences({ simulation });
      if (form.isConnected) formBaselines.set(form, fingerprint);
    } catch (error) {
      toast(error.message, true);
    }
    updater.refreshSafety();
  });
  if ($("#simulation-preset"))
    $("#simulation-preset").value =
      Object.entries(SIMULATION_PROFILES).find(([, values]) =>
        Object.keys(SIMULATION_DEFAULTS).every(
          (key, index) =>
            Math.abs(currentSimulationConfig[key] - values[index]) < 1e-9,
        ),
      )?.[0] || "custom";
  $("#simulation-form")?.addEventListener("input", (event) => {
    if (event.target.type !== "range") return;
    $("#simulation-preset").value = "custom";
    updateRangeOutputs();
    $("#simulation-status").textContent =
      "Parâmetros alterados. Toque em comparar para atualizar a curva.";
  });
  captureForms();
  paintSystemStatus();
  queueMicrotask(() => updater.refreshSafety());
}

function updateRangeOutputs() {
  for (const key of Object.keys(SIMULATION_DEFAULTS))
    $(`output[for="${key}"]`).textContent = n(Number($("#" + key).value), 2);
}
function simulationConfig() {
  return Object.fromEntries(
    Object.keys(SIMULATION_DEFAULTS).map((key) => [
      key,
      Number($("#" + key).value),
    ]),
  );
}
function updateSimulation() {
  const config = simulationConfig();
  currentSimulation = simulate(current().samples, config);
  currentSimulationConfig = config;
  activeChart.updateSimulation(currentSimulation);
  $("#simulation-status").textContent =
    "Curva atualizada. Apenas o modelo foi recalculado; os dados medidos permanecem intactos.";
}
function download(content, filename, mime = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function saveLiveRecording({
  vehicleId,
  samples,
  diagnostics,
  metadata,
  title,
}) {
  if (updateBarrier)
    throw new Error("Aguarde a atualização antes de salvar outra operação.");
  if (mutationInProgress) throw new Error("Aguarde o salvamento em andamento.");
  const vehicle = state.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle)
    throw new Error(
      "O veículo da sessão não está neste cadastro. Exporte a coleta e confira o backup.",
    );
  mutationInProgress = true;
  try {
    const next = structuredClone(state);
    const recording = newRecording(
      vehicle,
      title,
      "coleta_real_elm327.csv",
      samples,
      false,
      { ...metadata, operation_mode: "real" },
      diagnostics,
    );
    next.recordings.unshift(recording);
    next.selectedId = recording.id;
    await commit(next);
    location.hash = "#analise";
    render();
    toast(
      "Coleta salva com origem e horários documentados. Confira sua elegibilidade em Base real e estatísticas.",
    );
  } finally {
    mutationInProgress = false;
  }
}
async function fileData(file) {
  if (!(file instanceof File) || !file.size || !/\.csv$/i.test(file.name))
    throw new Error("Selecione um arquivo CSV não vazio.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Cada CSV pode ter até 5 MB.");
  const buffer = await file.arrayBuffer();
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return {
    text: decodeFile(buffer),
    metadata: { filename: file.name, sha256 },
  };
}
function requiredText(form, name, max = 200) {
  const value = String(form.get(name) || "").trim();
  if (!value || value.length > max)
    throw new Error(
      "Preencha os campos obrigatórios respeitando o limite de caracteres.",
    );
  return value;
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (
    ![
      "vehicle-form",
      "import-form",
      "analysis-form",
      "dtc-form",
      "provenance-form",
      "simulation-form",
      "system-form",
    ].includes(form.id)
  )
    return;
  event.preventDefault();
  if (updateBarrier) {
    toast("Aguarde a atualização em preparação.");
    return;
  }
  if (mutationInProgress) {
    toast("Aguarde a conclusão da operação em andamento.");
    return;
  }
  mutationInProgress = true;
  const recordingId = current()?.id;
  const button = $('button[type="submit"]', form);
  if (button) button.disabled = true;
  form.inert = true;
  const data = new FormData(form);
  try {
    if (form.id === "system-form") {
      await persistPreferences({
        automaticUpdates: data.get("automaticUpdates") === "on",
        favorites: data.getAll("favorite").map(String),
      });
      render();
      toast(
        "Preferências salvas neste aplicativo. Não é necessário instalar outro.",
      );
      return;
    }
    if (form.id === "simulation-form") {
      updateSimulation();
      const fingerprint = formFingerprint(form);
      await persistPreferences({ simulation: { ...currentSimulationConfig } });
      if (form.isConnected) formBaselines.set(form, fingerprint);
      return;
    }
    const next = structuredClone(state);
    let message;
    if (form.id === "vehicle-form") {
      const year = Number(data.get("year"));
      if (!Number.isInteger(year) || year < 1900 || year > 2100)
        throw new Error("Informe um ano entre 1900 e 2100.");
      const ecu = Object.fromEntries(
        [
          "manufacturer",
          "identification",
          "hardware",
          "software",
          "source",
        ].map((key) => [key, String(data.get(key) || "").trim()]),
      );
      if (ecu.source !== "Não confirmada" && !ecu.identification)
        throw new Error(
          "Informe a identificação da ECU ou deixe a origem como não confirmada.",
        );
      next.vehicles.unshift({
        id: uid(),
        brand: requiredText(data, "brand"),
        model: requiredText(data, "model"),
        year,
        engine: requiredText(data, "engine"),
        plate: String(data.get("plate") || "").trim(),
        ecu,
      });
      message = "Veículo e identificação da ECU cadastrados neste aparelho.";
    } else if (form.id === "import-form") {
      const vehicle = state.vehicles.find(
        (v) => v.id === data.get("vehicleId"),
      );
      if (!vehicle) throw new Error("Selecione um veículo cadastrado.");
      const input = await fileData(data.get("signals"));
      const mapping = Object.fromEntries(
        ["time_s", "pedal_pct", "throttle_pct", "rpm"].map((key) => [
          key,
          String(data.get(key) || ""),
        ]),
      );
      const parsed = parseSignals(input.text, mapping, data.get("timeUnit"));
      let diagnostics = [],
        dtcMeta;
      if (data.get("diagnostics")?.size) {
        const dtc = await fileData(data.get("diagnostics"));
        diagnostics = parseDiagnostics(dtc.text);
        dtcMeta = dtc.metadata;
      }
      const provenance = declaredSource(data, {
        reference: input.metadata.filename,
        sha256: input.metadata.sha256,
      });
      const metadata = {
        ...input.metadata,
        provenance,
        source: provenance.source,
        mapping: parsed.mapping,
        delimiter: parsed.delimiter,
        time_unit: data.get("timeUnit"),
      };
      const definitions = sourceDefinitions(data);
      if (definitions) metadata.signal_definitions = definitions;
      if (dtcMeta) metadata.diagnostic_report = dtcMeta;
      const r = newRecording(
        vehicle,
        String(data.get("title") || "").trim() || "Ensaio importado",
        input.metadata.filename,
        parsed.samples,
        false,
        metadata,
        diagnostics,
      );
      if (isSyntheticRecord(r))
        throw new Error(
          "Este arquivo corresponde a um exemplo fictício conhecido e não pode integrar a base real.",
        );
      const originStatus = provenanceStatus(r);
      if (!originStatus.eligible) throw new Error(originStatus.reason);
      next.recordings.unshift(r);
      next.selectedId = r.id;
      message = `${n(r.samples.length)} amostras importadas e validadas. Nenhum arquivo foi enviado ao servidor.`;
    } else if (form.id === "provenance-form") {
      const r = next.recordings.find((record) => record.id === recordingId);
      if (!r || !/^[a-f0-9]{64}$/i.test(r.metadata.sha256 || ""))
        throw new Error(
          "Reimporte o arquivo original para calcular seu SHA-256.",
        );
      r.metadata.provenance = declaredSource(data, {
        reference: r.filename,
        sha256: r.metadata.sha256,
      });
      const definitions = sourceDefinitions(data);
      if (definitions) r.metadata.signal_definitions = definitions;
      else delete r.metadata.signal_definitions;
      const status = provenanceStatus(r);
      if (!status.eligible) throw new Error(status.reason);
      message =
        "Origem documentada. O registro será avaliado nos grupos da base real.";
    } else if (form.id === "analysis-form") {
      const config = Object.fromEntries(
        Object.keys(ANALYSIS_DEFAULTS).map((key) => [
          key,
          Number(data.get(key)),
        ]),
      );
      analyze(current().samples, current().diagnostics, config);
      next.recordings.find((r) => r.id === recordingId).analysisConfig = config;
      message = "Critérios atualizados. Os relatórios usarão estes valores.";
    } else if (form.id === "dtc-form") {
      const dtc = await fileData(data.get("diagnostics"));
      const codes = parseDiagnostics(dtc.text);
      const r = next.recordings.find((r) => r.id === recordingId);
      r.diagnostics = codes;
      r.metadata.diagnostic_report = dtc.metadata;
      message = `${codes.length} DTC(s) associado(s) ao ensaio.`;
    }
    await commit(next);
    if (form.id === "import-form") location.hash = "#analise";
    render();
    toast(message);
    if (form.id === "import-form") window.scrollTo({ top: 0 });
  } catch (error) {
    toast(
      error.message ||
        "Não foi possível salvar. Faça um backup e verifique o armazenamento.",
      true,
    );
  } finally {
    mutationInProgress = false;
    form.inert = false;
    if (button) button.disabled = false;
    updater.refreshSafety();
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button,a");
  if (!target) return;
  try {
    if (target.hasAttribute("data-check-updates")) {
      await updater.check();
      return;
    }
    if (target.hasAttribute("data-apply-update")) {
      await updater.apply();
      return;
    }
    if (target.hasAttribute("data-install")) openInstall();
    if (target.hasAttribute("data-reload")) location.reload();
    if (target.hasAttribute("data-close-dialog")) $("#install-dialog").close();
    if (target.hasAttribute("data-export")) {
      const r = state.recordings.find((r) => r.id === target.dataset.recording);
      if (!r) throw new Error("Ensaio não encontrado.");
      const format = target.dataset.export,
        name = `auto_ecu_lab_${r.id.slice(0, 8)}`;
      if (format === "html")
        download(reportHtml(r), name + ".html", "text/html;charset=utf-8");
      if (format === "json")
        download(
          JSON.stringify(reportPayload(r), null, 2),
          name + ".json",
          "application/json",
        );
      if (format === "csv")
        download(recordingCsv(r), name + ".csv", "text/csv;charset=utf-8");
      toast(
        "Arquivo preparado. Se abrir uma prévia no iPhone, use Compartilhar → Salvar em Arquivos.",
      );
    }
    if (target.hasAttribute("data-export-statistics")) {
      const statistics = summarizeRecordings(state.recordings);
      download(
        JSON.stringify(
          {
            schema_version: 1,
            generated_at: new Date().toISOString(),
            method:
              "Descritivo local; p95 por posto mais próximo; origem declarada; simulações e duplicatas excluídas",
            ...statistics,
          },
          null,
          2,
        ),
        "auto_ecu_lab_estatisticas_reais.json",
        "application/json",
      );
      toast(
        "Estatísticas locais exportadas com contagens e critérios de origem.",
      );
    }
    if (target.hasAttribute("data-backup")) {
      download(
        stateJSON(state),
        "auto_ecu_lab_backup.json",
        "application/json",
      );
      toast(
        "Backup preparado. Se abrir uma prévia no iPhone, use Compartilhar → Salvar em Arquivos.",
      );
    }
    if (target.hasAttribute("data-download-simulation")) {
      const config = simulationConfig();
      const values = simulate(current().samples, config);
      updateSimulation();
      download(
        simulationCsv(current(), values, config),
        "auto_ecu_lab_simulacao.csv",
        "text/csv;charset=utf-8",
      );
      toast(
        "Simulação exportada com os parâmetros e colunas medidas separadas.",
      );
    }
    if (target.hasAttribute("data-open-recording")) {
      if (updateBarrier)
        throw new Error("Aguarde a atualização antes de alterar os ensaios.");
      if (mutationInProgress)
        throw new Error(
          "Aguarde a conclusão da operação antes de trocar de ensaio.",
        );
      mutationInProgress = true;
      try {
        await commit({ ...state, selectedId: target.dataset.openRecording });
        location.hash = "#analise";
        render();
        window.scrollTo({ top: 0 });
      } finally {
        mutationInProgress = false;
      }
    }
    if (target.hasAttribute("data-import-vehicle")) {
      importVehicleId = target.dataset.importVehicle;
      location.hash = "#importar";
      render();
    }
  } catch (error) {
    toast(error.message, true);
  }
});
document.addEventListener("change", async (event) => {
  let ownsMutation = false;
  try {
    if (event.target.hasAttribute("data-select-recording")) {
      if (updateBarrier) {
        event.target.value = state.selectedId;
        throw new Error("Aguarde a atualização.");
      }
      if (mutationInProgress) {
        event.target.value = state.selectedId;
        throw new Error(
          "Aguarde a conclusão da operação antes de trocar de ensaio.",
        );
      }
      mutationInProgress = true;
      ownsMutation = true;
      await commit({ ...state, selectedId: event.target.value });
      render();
    }
    if (event.target.id === "restore-backup") {
      if (updateBarrier)
        throw new Error("Aguarde a atualização antes de restaurar dados.");
      if (liveController.hasSession)
        throw new Error(
          "Desconecte a sessão real antes de restaurar um backup.",
        );
      if (mutationInProgress)
        throw new Error(
          "Aguarde a conclusão da operação antes de restaurar um backup.",
        );
      mutationInProgress = true;
      ownsMutation = true;
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024)
        throw new Error("Selecione um backup JSON de até 25 MB.");
      const restored = parseBackup(await file.text());
      if (
        !confirm(
          `Restaurar ${restored.vehicles.length} veículo(s) e ${restored.recordings.length} ensaio(s)? Isso substituirá os dados atuais deste aparelho. Baixe um backup antes se precisar mantê-los.`,
        )
      )
        return;
      const migration = await migrateRealBase(restored, { commit });
      if (!migration.removedRecordings && !migration.removedVehicles)
        await commit(restored);
      render();
      toast("Backup validado e restaurado neste aparelho.");
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (ownsMutation) mutationInProgress = false;
    if (event.target.id === "restore-backup") event.target.value = "";
    queueMicrotask(() => updater.refreshSafety());
  }
});
document.addEventListener("input", () =>
  queueMicrotask(() => updater.refreshSafety()),
);
document.addEventListener("change", () =>
  queueMicrotask(() => updater.refreshSafety()),
);
window.addEventListener("hashchange", () => {
  if (!state) return;
  if (route() === renderedRoute) return;
  if (updateBarrier) {
    location.hash = "#" + renderedRoute;
    return;
  }
  const dirty = [...formBaselines].some(
    ([form, baseline]) =>
      form.isConnected && formFingerprint(form) !== baseline,
  );
  if (
    dirty &&
    route() !== renderedRoute &&
    !mutationInProgress &&
    !confirm(
      "Há um formulário ou arquivo não salvo. Deseja sair desta tela e descartar esse rascunho?",
    )
  ) {
    location.hash = "#" + renderedRoute;
    return;
  }
  render();
  window.scrollTo({ top: 0 });
});

function openInstall() {
  $("#native-install").innerHTML =
    (installEvent
      ? '<button type="button" class="btn primary wide" id="native-install-button">Instalar aplicativo agora</button>'
      : "") +
    '<p id="install-offline-status" class="notice" role="status"></p>';
  $("#install-offline-status").textContent =
    $("#connection-status").textContent;
  $("#native-install-button")?.addEventListener("click", async () => {
    await installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    $("#install-dialog").close();
  });
  $("#install-dialog").showModal();
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event;
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  $("#install-dialog").close();
  toast("Aplicativo adicionado à tela inicial.");
});
$("#install-dialog").addEventListener("click", (event) => {
  if (event.target === $("#install-dialog")) $("#install-dialog").close();
});

function updateConnection() {
  const status = !navigator.onLine
    ? offlineReady
      ? "Offline · dados neste aparelho"
      : "Sem conexão"
    : offlineReady
      ? "Pronto para usar offline"
      : "Preparando uso offline…";
  setConnectionStatus(status);
  $("#connection-status").className =
    `connection-status ${navigator.onLine ? (offlineReady ? "ready" : "") : "offline"}`;
}
function setConnectionStatus(message) {
  $("#connection-status").textContent = message;
  $("#mobile-offline-status").textContent = message;
  if ($("#install-offline-status"))
    $("#install-offline-status").textContent = message;
}
$("#activate-update").addEventListener("click", () => updater.apply());
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);

async function boot() {
  try {
    state = await loadState();
    if (!state)
      await commit({
        schemaVersion: 1,
        vehicles: [],
        recordings: [],
        selectedId: "",
      });
    const migration = await migrateRealBase(state, { commit });
    state = migration.state;
    if (migration.removedRecordings)
      toast(
        `${migration.removedRecordings} registro(s) de demonstração foram separados em arquivo local e retirados da base ativa. Os demais dados foram preservados.`,
      );
    try {
      preferences = await loadPreferences();
    } catch {
      toast(
        "Preferências locais indisponíveis. Seus ensaios continuam preservados.",
        true,
      );
    }
    currentSimulationConfig = { ...preferences.simulation };
    updater.setAutomatic(preferences.automaticUpdates);
    render();
    updateConnection();
    updater.start();
  } catch (error) {
    $("#conteudo").innerHTML =
      heading(
        "ARMAZENAMENTO LOCAL",
        "Vamos preparar seu navegador",
        "O laboratório precisa de armazenamento local para manter seus ensaios.",
      ) +
      `<div class="error-message">${h(error.message)}</div><section class="panel help-panel"><h2>Como continuar</h2><p>Abra no Safari ou Chrome, permita dados de sites e use uma aba normal. Verifique também o espaço livre no aparelho. Se você já tinha dados aqui, exporte um backup antes de limpar qualquer armazenamento.</p><button type="button" class="btn primary" data-reload>Tentar novamente</button></section>`;
  }
}
boot();
