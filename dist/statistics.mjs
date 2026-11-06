/**
 * Estatísticas locais de medições com origem documentada. Um rótulo "real" não
 * comprova a origem: exigimos o contrato de proveniência abaixo e quatro sinais
 * válidos. Hashes são evidências declaradas do arquivo, não certificação externa.
 * Não há dados incorporados, acesso a repositórios nem referência de normalidade
 * OEM. Simulações e duplicatas não entram nas contagens. Atrasos são observações
 * discretas do analyze(), agrupadas apenas com ECU, sinais e critérios compatíveis.
 * p95 usa posto mais próximo (ceil(0,95 × n)); a mediana usa os dois centros.
 */
import { ANALYSIS_DEFAULTS, analyze, validateSamples } from "./core.mjs";
import { isSyntheticRecord } from "./real-base.mjs";

const FIELDS = ["time_s", "pedal_pct", "throttle_pct", "rpm"];
const KINDS = new Set([
  "scanner_capture",
  "scanner_report",
  "repository_dataset",
]);
const text = (value) => (typeof value === "string" ? value.trim() : "");
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const hex = (value, length) =>
  typeof value === "string" &&
  new RegExp(`^[a-f0-9]{${length}}$`, "i").test(value);
function dated(value) {
  if (typeof value !== "string") return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!parts) return false;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    parts.slice(1).map((part) => Number(part ?? 0));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= monthDays[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}
const metadataOf = (recording) => object(recording?.metadata);
const provenanceOf = (recording) => object(metadataOf(recording).provenance);
const captureId = (recording) => {
  const metadata = metadataOf(recording);
  return text(metadata.capture_id) || text(metadata.connection?.capture_id);
};
const sourceEcus = (recording) => {
  const metadata = metadataOf(recording);
  return [
    ...new Set(
      [
        metadata.identity?.ecuId,
        metadata.connection?.adapter?.ecuId,
        ...(Array.isArray(metadata.channel_timestamps)
          ? metadata.channel_timestamps.map((channel) => channel?.ecuId)
          : []),
      ]
        .map((value) => text(value).toUpperCase())
        .filter(Boolean),
    ),
  ].sort();
};
const fileHash = (recording) => {
  const metadata = metadataOf(recording);
  const provenance = provenanceOf(recording);
  const value = hex(metadata.sha256, 64) ? metadata.sha256 : provenance.sha256;
  return hex(value, 64) ? value.toLowerCase() : null;
};

/** Valida evidências declaradas; não infere origem por isDemo=false ou pelo nome. */
export function provenanceStatus(recording) {
  const metadata = metadataOf(recording);
  const provenance = provenanceOf(recording);
  const kind = KINDS.has(provenance.kind) ? provenance.kind : null;
  const reject = (reason) => ({ eligible: false, reason, kind });
  if (!recording || typeof recording !== "object")
    return reject("Registro inválido.");
  if (recording.isDemo || isSyntheticRecord(recording))
    return reject("Simulação ou dados fictícios ficam fora da base real.");
  if (isSyntheticRecord({ metadata: object(metadata.diagnostic_report) }))
    return reject(
      "O relatório DTC anexado corresponde a dados fictícios; separe-o da medição real.",
    );
  try {
    validateSamples(recording.samples);
  } catch (error) {
    return reject(`Amostras inválidas: ${error.message}`);
  }
  if (!kind || provenance.schema_version !== 1)
    return reject("Proveniência ausente ou versão não suportada.");
  if (
    !text(provenance.source) ||
    !text(provenance.reference) ||
    !dated(provenance.captured_at)
  )
    return reject(
      "Informe fonte, referência e data de aquisição com fuso horário.",
    );
  if (
    metadata.sha256 &&
    provenance.sha256 &&
    text(metadata.sha256).toLowerCase() !==
      text(provenance.sha256).toLowerCase()
  )
    return reject("Os hashes declarados do arquivo divergem.");
  if (kind === "scanner_capture") {
    if (
      provenance.verification !== "protocol_capture" ||
      !dated(metadata.connection?.started_at_utc) ||
      !captureId(recording) ||
      !sourceEcus(recording).length
    )
      return reject(
        "Coleta exige protocolo, início com fuso, identificador de captura e ECU de origem.",
      );
    if (sourceEcus(recording).length !== 1)
      return reject(
        "A coleta reúne origens ECU diferentes; separe os canais antes de analisar.",
      );
  } else if (kind === "scanner_report") {
    if (
      provenance.verification !== "operator_confirmed" ||
      !hex(fileHash(recording), 64)
    )
      return reject(
        "Relatório exige confirmação do operador e SHA-256 do arquivo original.",
      );
  } else {
    let url;
    try {
      url = new URL(provenance.repository_url);
    } catch {
      /* origem inválida */
    }
    if (
      provenance.verification !== "documented_dataset" ||
      !url ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !hex(provenance.revision, 40) ||
      !text(provenance.license) ||
      !hex(fileHash(recording), 64)
    )
      return reject(
        "Dataset exige URL HTTPS, commit, licença, SHA-256 e documentação da origem.",
      );
  }
  return {
    eligible: true,
    reason: "Metadados de origem completos para análise local.",
    kind,
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}

function configuration(recording) {
  const supplied = object(recording?.analysisConfig);
  return Object.fromEntries(
    Object.entries(ANALYSIS_DEFAULTS).map(([key, value]) => [
      key,
      supplied[key] === undefined ? value : supplied[key],
    ]),
  );
}

function recordId(recording) {
  const provenance = provenanceOf(recording);
  return (
    text(recording?.id) ||
    [
      provenance.kind,
      provenance.source,
      provenance.reference,
      provenance.captured_at,
    ]
      .map(text)
      .join("|")
  );
}

function vehicleId(recording) {
  return (
    text(recording?.vehicleId) ||
    text(recording?.vehicle?.id) ||
    `registro:${recordId(recording)}`
  );
}

function identityOf(recording) {
  const vehicle = object(recording?.vehicle);
  const ecu = object(vehicle.ecu);
  const metadata = metadataOf(recording);
  const definitions = object(
    metadata.signal_definitions || metadata.pid_definitions,
  );
  const hasDefinitions = FIELDS.every(
    (key) =>
      text(definitions[key]) || Object.keys(object(definitions[key])).length,
  );
  const confirmed =
    text(ecu.identification) &&
    text(ecu.source) &&
    !/^(não confirmada|nao confirmada|desconhecida|unknown)$/i.test(
      text(ecu.source),
    ) &&
    !/^(não confirmada|nao confirmada|desconhecida|unknown)$/i.test(
      text(ecu.identification),
    );
  const completeVehicle =
    text(vehicle.brand) &&
    text(vehicle.model) &&
    Number.isInteger(Number(vehicle.year)) &&
    Number(vehicle.year) >= 1900 &&
    text(vehicle.engine);
  return {
    brand: text(vehicle.brand),
    model: text(vehicle.model),
    year: vehicle.year == null ? null : Number(vehicle.year),
    engine: text(vehicle.engine),
    ecu_id: confirmed ? text(ecu.identification) : null,
    hardware: text(ecu.hardware) || null,
    software: text(ecu.software) || null,
    acquisition_ecu_ids: sourceEcus(recording),
    isolated_vehicle:
      !confirmed ||
      !completeVehicle ||
      !text(ecu.hardware) ||
      !text(ecu.software)
        ? vehicleId(recording)
        : null,
    // Sem definição documentada, não presumimos que cabeçalhos equivalem a PIDs.
    isolated_recording: hasDefinitions ? null : recordId(recording),
    signal_definitions: hasDefinitions ? stable(definitions) : null,
    analysis_config: configuration(recording),
  };
}

/** Chave canônica; ECU/HW/SW incompletos isolam o veículo, sinais ausentes o registro. */
export function cohortKey(recording) {
  return JSON.stringify(stable(identityOf(recording)));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function delaySummary(events, field) {
  const observed = events
    .filter((event) => event.usable && Number.isFinite(event[field]))
    .map((event) => event[field])
    .sort((a, b) => a - b);
  return {
    observed: observed.length,
    missing: events.filter((event) => event.usable && event[field] === null)
      .length,
    min_s: observed[0] ?? null,
    max_s: observed.at(-1) ?? null,
    median_s: median(observed),
    p95_s: observed.length
      ? observed[Math.ceil(observed.length * 0.95) - 1]
      : null,
  };
}

function samePrefix(left, right) {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.every((sample, index) =>
    FIELDS.every((field) => sample[field] === longer[index][field]),
  );
}

function captureEvidence(recording) {
  const metadata = metadataOf(recording),
    provenance = provenanceOf(recording);
  return JSON.stringify(
    stable({
      source: text(provenance.source),
      captured_at_ms: Date.parse(provenance.captured_at),
      started_at_ms: Date.parse(metadata.connection?.started_at_utc),
      source_ecus: sourceEcus(recording),
      vehicle_id: vehicleId(recording),
      signal_definitions: object(
        metadata.signal_definitions || metadata.pid_definitions,
      ),
    }),
  );
}

function cohortSummary(key, entries) {
  const first = entries[0].recording,
    identity = identityOf(first);
  const intervals = [],
    events = [],
    samples = [],
    codes = new Set();
  let gaps = 0,
    duration = 0,
    known = 0,
    withCodes = 0;
  for (const { recording, result } of entries) {
    samples.push(...recording.samples);
    duration += result.duration_s;
    events.push(...result.events);
    const gapLimit = Math.max(0.5, result.interval_s * 3);
    for (let index = 1; index < recording.samples.length; index++) {
      const interval =
        recording.samples[index].time_s - recording.samples[index - 1].time_s;
      intervals.push(interval);
      if (interval > gapLimit) gaps++;
    }
    const diagnosticResult = metadataOf(recording).diagnostic_result;
    // [] sozinho pode significar que DTC nunca foi consultado/importado.
    if (diagnosticResult?.complete === true) known++;
    const observed = [
      ...(Array.isArray(recording.diagnostics) ? recording.diagnostics : []),
      ...(Array.isArray(diagnosticResult?.codes) ? diagnosticResult.codes : []),
    ]
      .map((item) => text(typeof item === "string" ? item : item?.code))
      .filter(Boolean);
    if (observed.length) withCodes++;
    observed.forEach((code) => codes.add(code.toUpperCase()));
  }
  const range = (field) => {
    let min = Infinity,
      max = -Infinity;
    for (const sample of samples) {
      min = Math.min(min, sample[field]);
      max = Math.max(max, sample[field]);
    }
    return {
      min: samples.length ? min : null,
      max: samples.length ? max : null,
    };
  };
  return {
    key,
    label: [
      identity.brand,
      identity.model,
      identity.year,
      identity.engine,
      identity.ecu_id || "ECU não confirmada",
    ]
      .filter((value) => value != null && value !== "")
      .join(" · "),
    identity,
    recording_ids: entries.map(({ recording }) => recordId(recording)),
    sessions: entries.length,
    vehicles: new Set(entries.map(({ recording }) => vehicleId(recording)))
      .size,
    samples: samples.length,
    duration_s: duration,
    acquisition: {
      median_interval_s: median(intervals),
      min_interval_s: intervals.length
        ? intervals.reduce((a, b) => Math.min(a, b))
        : null,
      max_interval_s: intervals.length
        ? intervals.reduce((a, b) => Math.max(a, b))
        : null,
      gaps,
    },
    signals: {
      pedal_pct: range("pedal_pct"),
      throttle_pct: range("throttle_pct"),
      rpm: range("rpm"),
    },
    events: {
      total: events.length,
      usable: events.filter((event) => event.usable).length,
      excluded_gaps: events.filter((event) => !event.usable).length,
    },
    throttle_delay: delaySummary(events, "throttle_delay_s"),
    rpm_delay: delaySummary(events, "rpm_delay_s"),
    dtc: {
      known_sessions: known,
      unknown_sessions: entries.length - known,
      sessions_with_codes: withCodes,
      observed_codes: [...codes].sort(),
    },
  };
}

/**
 * As contagens elegíveis são posteriores à deduplicação. Repetições de arquivo
 * preservam a primeira entrada; capturas de mesmo ID preservam o maior prefixo.
 * Todas as variantes de um ID com amostras ou evidências divergentes são excluídas como
 * conflito, independentemente da ordem. Conflitos não são duplicatas normais. Nenhum
 * intervalo é calculado entre sessões nem há mediana global entre coortes.
 */
export function summarizeRecordings(recordings = []) {
  const input = Array.isArray(recordings) ? recordings : [];
  const excluded = [],
    candidates = [],
    entries = [],
    seen = new Map(),
    captureGroups = new Map();
  const reject = (recording, reason, kind, duplicateOf, conflictId) =>
    excluded.push({
      id: recordId(recording),
      reason,
      kind,
      ...(duplicateOf ? { duplicate_of: recordId(duplicateOf) } : {}),
      ...(conflictId ? { conflict_capture_id: conflictId } : {}),
    });
  for (const recording of input) {
    const status = provenanceStatus(recording);
    if (!status.eligible) {
      reject(recording, status.reason, status.kind);
      continue;
    }
    let result, key;
    try {
      result = analyze(recording.samples, [], recording.analysisConfig || {});
      key = cohortKey(recording);
    } catch (error) {
      reject(recording, `Análise inválida: ${error.message}`, status.kind);
      continue;
    }
    const hash = fileHash(recording);
    const captureKey =
      status.kind === "scanner_capture"
        ? `capture:${captureId(recording)}`
        : null;
    const keys = [captureKey, hex(hash, 64) ? `sha256:${hash}` : null].filter(
      Boolean,
    );
    const candidate = {
      recording,
      result,
      key,
      kind: status.kind,
      keys: new Set(keys),
      captureKey,
      captureEvidence: captureKey ? captureEvidence(recording) : null,
    };
    candidates.push(candidate);
    if (captureKey) {
      const group = captureGroups.get(captureKey);
      if (!group)
        captureGroups.set(captureKey, { longest: candidate, conflict: false });
      else {
        if (
          group.longest.captureEvidence !== candidate.captureEvidence ||
          !samePrefix(group.longest.recording.samples, recording.samples)
        )
          group.conflict = true;
        if (recording.samples.length > group.longest.recording.samples.length)
          group.longest = candidate;
      }
    }
  }
  for (const candidate of candidates) {
    const { recording, result, key, kind, captureKey, keys } = candidate;
    if (captureKey && captureGroups.get(captureKey).conflict) {
      reject(
        recording,
        "Conflito: todas as variantes deste identificador de captura foram excluídas por amostras ou evidências divergentes.",
        kind,
        null,
        captureId(recording),
      );
      continue;
    }
    const previous = [...keys]
      .map((identity) => seen.get(identity))
      .find(Boolean);
    if (previous) {
      const sameCapture = captureKey && previous.keys.has(captureKey);
      if (
        sameCapture &&
        recording.samples.length > previous.recording.samples.length
      ) {
        reject(
          previous.recording,
          "Captura repetida: mantida a versão mais completa do mesmo prefixo.",
          previous.kind,
          recording,
        );
        previous.recording = recording;
        previous.result = result;
        previous.key = key;
        keys.forEach((identity) => {
          previous.keys.add(identity);
          seen.set(identity, previous);
        });
      } else {
        reject(
          recording,
          sameCapture
            ? "Captura repetida: versão já contabilizada."
            : "Arquivo repetido: SHA-256 já contabilizado.",
          kind,
          previous.recording,
        );
      }
      continue;
    }
    entries.push(candidate);
    keys.forEach((identity) => seen.set(identity, candidate));
  }
  const groups = new Map();
  entries.forEach((entry) => {
    if (!groups.has(entry.key)) groups.set(entry.key, []);
    groups.get(entry.key).push(entry);
  });
  const cohorts = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => cohortSummary(key, group));
  return {
    totals: {
      received_records: input.length,
      eligible_records: entries.length,
      sessions: entries.length,
      vehicles: new Set(entries.map(({ recording }) => vehicleId(recording)))
        .size,
      samples: entries.reduce(
        (total, { recording }) => total + recording.samples.length,
        0,
      ),
      cohorts: cohorts.length,
      excluded_records: excluded.length,
      duplicate_records: excluded.filter((entry) => entry.duplicate_of).length,
    },
    cohorts,
    excluded,
  };
}
