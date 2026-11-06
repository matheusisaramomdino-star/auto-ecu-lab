import test from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_DEFAULTS } from "../dist/core.mjs";
import { KNOWN_SYNTHETIC_HASHES } from "../dist/real-base.mjs";
import {
  cohortKey,
  provenanceStatus,
  summarizeRecordings,
} from "../dist/statistics.mjs";

// Dados sintéticos restritos aos testes: nunca são distribuídos como medições.
const definitions = {
  time_s: "monotonic_seconds",
  pedal_pct: "OBD-II 01 49 percent",
  throttle_pct: "OBD-II 01 11 percent",
  rpm: "OBD-II 01 0C rpm",
};
const samples = (delaySteps = 4) =>
  Array.from({ length: 41 }, (_, index) => ({
    time_s: index / 10,
    pedal_pct: index >= 1 ? 40 : 0,
    throttle_pct: index >= 1 + delaySteps ? 35 : 5,
    rpm: index >= 2 + delaySteps ? 1400 : 850,
  }));
const hash = (number) => number.toString(16).padStart(64, "0");
function report(id = "r1", number = 1) {
  return {
    id,
    vehicleId: "v1",
    isDemo: false,
    vehicle: {
      id: "v1",
      brand: "Fiat",
      model: "Strada",
      year: 2022,
      engine: "1.4",
      ecu: {
        identification: "ecu-observada",
        source: "Informada no scanner",
        hardware: "hw-a",
        software: "sw-a",
      },
    },
    samples: samples(),
    diagnostics: [],
    analysisConfig: {},
    metadata: {
      operation_mode: "imported",
      sha256: hash(number),
      signal_definitions: structuredClone(definitions),
      provenance: {
        schema_version: 1,
        kind: "scanner_report",
        source: "Relatório do scanner",
        captured_at: "2026-11-06T10:00:00-03:00",
        verification: "operator_confirmed",
        reference: `${id}.csv`,
      },
    },
  };
}
function capture(id = "r1", captureId = "capture-1") {
  const recording = report(id);
  delete recording.metadata.sha256;
  recording.metadata.operation_mode = "real";
  recording.metadata.connection = {
    capture_id: captureId,
    started_at_utc: "2026-11-06T13:00:00Z",
  };
  recording.metadata.identity = { ecuId: "7E8" };
  recording.metadata.provenance = {
    schema_version: 1,
    kind: "scanner_capture",
    source: "ELM327",
    captured_at: "2026-11-06T13:00:00Z",
    verification: "protocol_capture",
    reference: captureId,
  };
  return recording;
}
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

test("base vazia tem contagens zero, sem estatísticas ou atrasos globais", () => {
  const result = summarizeRecordings();
  assert.deepEqual(result, {
    totals: {
      received_records: 0,
      eligible_records: 0,
      sessions: 0,
      vehicles: 0,
      samples: 0,
      cohorts: 0,
      excluded_records: 0,
      duplicate_records: 0,
    },
    cohorts: [],
    excluded: [],
  });
});

test("isDemo=false e CSV legado sem confirmação não são evidência de medição real", () => {
  const recording = report();
  delete recording.metadata.provenance;
  assert.equal(provenanceStatus(recording).eligible, false);
  assert.equal(summarizeRecordings([recording]).totals.samples, 0);
  recording.metadata.provenance = report().metadata.provenance;
  recording.metadata.provenance.verification = "unverified";
  assert.match(provenanceStatus(recording).reason, /confirmação/);
});

test("hash de exemplo antigo permanece excluído mesmo com confirmação e isDemo=false", () => {
  const recording = report();
  recording.metadata.sha256 = KNOWN_SYNTHETIC_HASHES[0];
  assert.equal(provenanceStatus(recording).eligible, false);
  assert.equal(summarizeRecordings([recording]).totals.sessions, 0);
  delete recording.metadata.sha256;
  recording.metadata.provenance.sha256 =
    KNOWN_SYNTHETIC_HASHES[0].toUpperCase();
  assert.equal(provenanceStatus(recording).eligible, false);
});

test("DTC fictício anexado exclui medição das estatísticas sem relabelar seu sinal como sintético", () => {
  for (const diagnosticReport of [
    { filename: "dtc.csv", sha256: KNOWN_SYNTHETIC_HASHES[0] },
    {
      filename: "dtc.csv",
      provenance: { sha256: KNOWN_SYNTHETIC_HASHES[1].toUpperCase() },
    },
  ]) {
    const recording = report();
    recording.metadata.diagnostic_report = diagnosticReport;
    const status = provenanceStatus(recording);
    assert.equal(status.eligible, false);
    assert.match(status.reason, /DTC.*fictícios/);
    const result = summarizeRecordings([recording]);
    assert.equal(result.totals.sessions, 0);
    assert.equal(result.totals.excluded_records, 1);
    assert.equal(recording.isDemo, false);
    assert.equal(recording.metadata.sha256, hash(1));
  }
});

test("relatório confirmado exige data com fuso, fonte, referência e hash do arquivo", () => {
  assert.equal(provenanceStatus(report()).eligible, true);
  for (const [field, value] of [
    ["source", ""],
    ["reference", ""],
    ["captured_at", "2026-11-06T10:00:00"],
  ]) {
    const recording = report();
    recording.metadata.provenance[field] = value;
    assert.equal(provenanceStatus(recording).eligible, false, field);
  }
  for (const value of [undefined, "arquivo.csv", 123, "f".repeat(63)]) {
    const recording = report();
    recording.metadata.sha256 = value;
    assert.equal(provenanceStatus(recording).eligible, false);
  }
  const disagreement = report();
  disagreement.metadata.provenance.sha256 = hash(2);
  assert.match(provenanceStatus(disagreement).reason, /divergem/);
});

test("datas civis impossíveis não são normalizadas e UTC/offsets válidos são aceitos", () => {
  for (const timestamp of [
    "2026-02-31T10:00:00Z",
    "2026-02-29T10:00:00-03:00",
    "2100-02-29T10:00:00Z",
    "2026-04-31T10:00:00Z",
    "2026-00-10T10:00:00Z",
    "2026-01-00T10:00:00Z",
    "2026-11-06T24:00:00Z",
    "2026-11-06T10:60:00Z",
    "2026-11-06T10:00:60Z",
    "2026-11-06T10:00:00+24:00",
    "2026-11-06T10:00:00+03:60",
  ]) {
    const value = report();
    value.metadata.provenance.captured_at = timestamp;
    assert.equal(provenanceStatus(value).eligible, false, timestamp);
  }
  for (const timestamp of [
    "2024-02-29T10:00:00Z",
    "2000-02-29T10:00:00Z",
    "2026-11-06T13:00:00.123Z",
    "2026-11-06T10:00:00-03:00",
    "2026-11-06T18:30:00.123+05:30",
  ]) {
    const value = report();
    value.metadata.provenance.captured_at = timestamp;
    assert.equal(provenanceStatus(value).eligible, true, timestamp);
  }
  const invalidStart = capture();
  invalidStart.metadata.connection.started_at_utc = "2026-02-31T10:00:00Z";
  assert.equal(provenanceStatus(invalidStart).eligible, false);
});

test("sinais inválidos, modos simulados e parâmetros inválidos são excluídos sem derrubar a base", () => {
  const demo = report("demo");
  demo.isDemo = true;
  const simulated = report("simulation");
  simulated.metadata.operation_mode = "simulation";
  const invalid = report("invalid");
  invalid.samples[1].rpm = NaN;
  const duplicateTime = report("time");
  duplicateTime.samples[1].time_s = 0;
  const config = report("config");
  config.analysisConfig.response_window_s = -1;
  const result = summarizeRecordings([
    demo,
    simulated,
    invalid,
    duplicateTime,
    config,
  ]);
  assert.equal(result.totals.excluded_records, 5);
  assert.equal(result.totals.sessions, 0);
  assert.match(result.excluded.at(-1).reason, /Análise inválida/);
});

test("captura exige sessão de protocolo, ID, início e ECU selecionada", () => {
  assert.equal(provenanceStatus(capture()).eligible, true);
  for (const change of [
    (recording) => {
      delete recording.metadata.connection.capture_id;
    },
    (recording) => {
      delete recording.metadata.connection.started_at_utc;
    },
    (recording) => {
      delete recording.metadata.identity;
    },
    (recording) => {
      recording.metadata.provenance.verification = "operator_confirmed";
    },
  ]) {
    const recording = capture();
    change(recording);
    assert.equal(provenanceStatus(recording).eligible, false);
  }
  const channels = capture();
  delete channels.metadata.identity;
  channels.metadata.channel_timestamps = [{ ecuId: "7E8" }, { ecuId: "7E8" }];
  assert.equal(provenanceStatus(channels).eligible, true);
  channels.metadata.channel_timestamps.push({ ecuId: "7E9" });
  assert.match(provenanceStatus(channels).reason, /origens ECU diferentes/);
});

test("dataset de repositório exige documentação, HTTPS, commit, licença e integridade", () => {
  const recording = report();
  Object.assign(recording.metadata.provenance, {
    kind: "repository_dataset",
    verification: "documented_dataset",
    repository_url: "https://example.org/medicoes",
    revision: "a".repeat(40),
    license: "CC-BY-4.0",
  });
  assert.equal(provenanceStatus(recording).eligible, true);
  for (const [field, value] of [
    ["repository_url", "http://example.org"],
    ["revision", "main"],
    ["license", ""],
  ]) {
    const changed = structuredClone(recording);
    changed.metadata.provenance[field] = value;
    assert.equal(provenanceStatus(changed).eligible, false, field);
  }
});

test("mesmo SHA-256 é contabilizado uma vez e preserva o primeiro arquivo", () => {
  const first = report("original"),
    duplicate = report("copia");
  duplicate.vehicleId = "outro-veiculo";
  const result = summarizeRecordings([first, duplicate]);
  assert.equal(result.totals.sessions, 1);
  assert.equal(result.totals.duplicate_records, 1);
  assert.deepEqual(result.cohorts[0].recording_ids, ["original"]);
  assert.equal(result.excluded[0].duplicate_of, "original");
  assert.equal(result.totals.samples, first.samples.length);
});

test("salvamentos de mesma captura conservam o maior prefixo sem contar amostras duas vezes", () => {
  const shorter = capture("parcial"),
    longer = capture("completa");
  shorter.samples = shorter.samples.slice(0, 15);
  const result = summarizeRecordings([shorter, longer]);
  assert.equal(result.totals.sessions, 1);
  assert.equal(result.totals.samples, longer.samples.length);
  assert.equal(result.excluded[0].id, "parcial");
  assert.equal(result.excluded[0].duplicate_of, "completa");
  assert.deepEqual(result.cohorts[0].recording_ids, ["completa"]);
});

test("ID de captura com amostras conflitantes exclui todas as variantes em qualquer ordem", () => {
  const first = capture("primeira"),
    conflicting = capture("divergente");
  conflicting.samples[2].pedal_pct = 41;
  for (const recordings of [
    [first, conflicting],
    [conflicting, first],
  ]) {
    const result = summarizeRecordings(recordings);
    assert.equal(result.totals.sessions, 0);
    assert.equal(result.totals.samples, 0);
    assert.equal(result.totals.excluded_records, 2);
    assert.equal(result.totals.duplicate_records, 0);
    assert.deepEqual(result.cohorts, []);
    result.excluded.forEach((entry) => {
      assert.match(entry.reason, /Conflito.*todas as variantes/);
      assert.equal(entry.conflict_capture_id, "capture-1");
      assert.equal(Object.hasOwn(entry, "duplicate_of"), false);
    });
  }
});

test("conflito invalida inclusive prefixo e terceira variante, preservando capturas independentes", () => {
  const prefix = capture("prefixo"),
    first = capture("completa"),
    conflicting = capture("divergente");
  prefix.samples = prefix.samples.slice(0, 2);
  conflicting.samples[2].pedal_pct = 41;
  // Mudar o nome da fonte não cria outro grupo para o mesmo capture_id.
  conflicting.metadata.provenance.source = "ELM327 · outra descrição";
  const independent = capture("independente", "capture-2");
  const variants = [prefix, first, conflicting];
  for (const ordering of [
    variants,
    [...variants].reverse(),
    [first, conflicting, prefix],
  ]) {
    const result = summarizeRecordings([independent, ...ordering]);
    assert.equal(result.totals.sessions, 1);
    assert.equal(result.totals.samples, independent.samples.length);
    assert.equal(result.totals.excluded_records, 3);
    assert.equal(result.totals.duplicate_records, 0);
    assert.deepEqual(result.cohorts[0].recording_ids, ["independente"]);
    assert.ok(
      result.excluded.every(
        (entry) => entry.conflict_capture_id === "capture-1",
      ),
    );
  }
});

test("mesmo UUID com evidência de captura divergente invalida todas as variantes mesmo com amostras iguais", () => {
  for (const modify of [
    (value) => {
      value.metadata.provenance.source = "Outro scanner";
    },
    (value) => {
      value.metadata.provenance.captured_at = "2026-11-06T13:01:00Z";
    },
    (value) => {
      value.metadata.connection.started_at_utc = "2026-11-06T13:01:00Z";
    },
    (value) => {
      value.metadata.identity.ecuId = "7E9";
    },
    (value) => {
      value.metadata.signal_definitions.pedal_pct = "OBD-II 01 4A percent";
    },
    (value) => {
      value.vehicleId = "v2";
    },
  ]) {
    const original = capture("original"),
      changed = capture("alterada");
    modify(changed);
    assert.equal(provenanceStatus(changed).eligible, true);
    for (const variants of [
      [original, changed],
      [changed, original],
    ]) {
      const result = summarizeRecordings(variants);
      assert.equal(result.totals.sessions, 0);
      assert.equal(result.totals.excluded_records, 2);
      assert.equal(result.totals.duplicate_records, 0);
      assert.ok(
        result.excluded.every(
          (entry) => entry.conflict_capture_id === "capture-1",
        ),
      );
      assert.ok(
        result.excluded.every((entry) =>
          /evidências divergentes/.test(entry.reason),
        ),
      );
    }
  }
});

test("evidência equivalente em outro fuso e ordem de definições mantém o maior prefixo", () => {
  const original = capture("prefixo"),
    complete = capture("completa");
  original.samples = original.samples.slice(0, 10);
  complete.metadata.provenance.captured_at = "2026-11-06T10:00:00-03:00";
  complete.metadata.connection.started_at_utc = "2026-11-06T10:00:00-03:00";
  complete.metadata.signal_definitions = Object.fromEntries(
    Object.entries(definitions).reverse(),
  );
  const result = summarizeRecordings([original, complete]);
  assert.equal(result.totals.sessions, 1);
  assert.equal(result.totals.duplicate_records, 1);
  assert.deepEqual(result.cohorts[0].recording_ids, ["completa"]);
});

test("coortes exigem marca/modelo/ano/motor/ECU/HW/SW, sinais e critérios compatíveis", () => {
  const base = report();
  for (const modify of [
    (recording) => {
      recording.vehicle.brand = "Toyota";
    },
    (recording) => {
      recording.vehicle.model = "Hilux";
    },
    (recording) => {
      recording.vehicle.year = 2021;
    },
    (recording) => {
      recording.vehicle.engine = "1.8";
    },
    (recording) => {
      recording.vehicle.ecu.identification = "outra-ecu";
    },
    (recording) => {
      recording.vehicle.ecu.hardware = "hw-b";
    },
    (recording) => {
      recording.vehicle.ecu.software = "sw-b";
    },
    (recording) => {
      recording.metadata.signal_definitions.pedal_pct = "OBD-II 01 4A percent";
    },
    (recording) => {
      recording.analysisConfig.slow_threshold_s = 0.8;
    },
  ]) {
    const changed = report("r2", 2);
    modify(changed);
    assert.notEqual(cohortKey(changed), cohortKey(base));
    assert.equal(summarizeRecordings([base, changed]).cohorts.length, 2);
  }
  const compatible = report("r2", 2);
  compatible.vehicleId = "v2";
  compatible.analysisConfig = { ...ANALYSIS_DEFAULTS };
  compatible.metadata.signal_definitions = Object.fromEntries(
    Object.entries(definitions).reverse(),
  );
  assert.equal(cohortKey(base), cohortKey(compatible));
  const pooled = summarizeRecordings([base, compatible]);
  assert.equal(pooled.cohorts[0].sessions, 2);
  assert.equal(pooled.cohorts[0].vehicles, 2);
  assert.equal(Object.hasOwn(pooled.totals, "median_throttle_delay_s"), false);
});

test("ECU ou HW/SW não confirmados isolam o veículo e sinais indefinidos isolam o registro", () => {
  const first = report("r1", 1),
    second = report("r2", 2);
  first.vehicle.ecu.source = second.vehicle.ecu.source = "Não confirmada";
  second.vehicleId = "v2";
  assert.notEqual(cohortKey(first), cohortKey(second));
  second.vehicleId = "v1";
  assert.equal(cohortKey(first), cohortKey(second));
  delete first.metadata.signal_definitions;
  delete second.metadata.signal_definitions;
  assert.notEqual(cohortKey(first), cohortKey(second));
  for (const field of ["hardware", "software"]) {
    const left = report("r1", 1),
      right = report("r2", 2);
    left.vehicle.ecu[field] = right.vehicle.ecu[field] = "";
    right.vehicleId = "v2";
    assert.notEqual(cohortKey(left), cohortKey(right));
  }
});

test("mediana e p95 usam somente atrasos medidos, com posto próximo para p95", () => {
  const recordings = Array.from({ length: 20 }, (_, index) => {
    const recording = report(`r${index}`, index + 1);
    recording.samples = samples(index + 1);
    return recording;
  });
  const result = summarizeRecordings(recordings),
    cohort = result.cohorts[0];
  assert.equal(cohort.throttle_delay.observed, 20);
  close(cohort.throttle_delay.min_s, 0.1);
  close(cohort.throttle_delay.max_s, 2);
  close(cohort.throttle_delay.median_s, 1.05);
  close(cohort.throttle_delay.p95_s, 1.9);
  close(cohort.rpm_delay.median_s, 1.15);
  assert.equal(cohort.samples, 20 * 41);
});

test("não resposta observada permanece null, nunca vira atraso zero ou diagnóstico de falha", () => {
  const recording = report();
  recording.samples = recording.samples.map((sample) => ({
    ...sample,
    throttle_pct: 5,
    rpm: 850,
  }));
  const cohort = summarizeRecordings([recording]).cohorts[0];
  assert.deepEqual(cohort.throttle_delay, {
    observed: 0,
    missing: 1,
    min_s: null,
    max_s: null,
    median_s: null,
    p95_s: null,
  });
  assert.equal(cohort.rpm_delay.missing, 1);
  assert.equal(cohort.events.usable, 1);
  assert.equal(Object.hasOwn(cohort, "failure_rate"), false);
});

test("lacunas de aquisição e eventos afetados são contados separadamente de não respostas", () => {
  const recording = report();
  recording.samples = recording.samples.filter(
    (sample) => sample.time_s <= 0.2 || sample.time_s >= 1.5,
  );
  const cohort = summarizeRecordings([recording]).cohorts[0];
  assert.equal(cohort.acquisition.gaps, 1);
  close(cohort.acquisition.min_interval_s, 0.1);
  close(cohort.acquisition.max_interval_s, 1.3);
  assert.equal(cohort.events.excluded_gaps, 1);
  assert.equal(cohort.throttle_delay.observed, 0);
  assert.equal(cohort.throttle_delay.missing, 0);
  assert.equal(cohort.throttle_delay.median_s, null);
});

test("intervalos são calculados dentro das sessões, ranges usam amostras registradas", () => {
  const first = report("r1", 1),
    second = report("r2", 2);
  first.samples = [0, 0.1, 0.2, 0.3].map((time_s) => ({
    time_s,
    pedal_pct: 0,
    throttle_pct: 5,
    rpm: 850,
  }));
  second.samples = [500, 500.5, 501].map((time_s) => ({
    time_s,
    pedal_pct: 20,
    throttle_pct: 30,
    rpm: 1500,
  }));
  const cohort = summarizeRecordings([first, second]).cohorts[0];
  close(cohort.acquisition.median_interval_s, 0.1);
  close(cohort.acquisition.max_interval_s, 0.5);
  close(cohort.duration_s, 1.3);
  assert.deepEqual(cohort.signals.rpm, { min: 850, max: 1500 });
  assert.deepEqual(cohort.signals.pedal_pct, { min: 0, max: 20 });
  assert.equal(cohort.throttle_delay.median_s, null);
});

test("DTC não consultado permanece desconhecido mesmo com lista vazia", () => {
  const unknown = report("unknown", 1),
    complete = report("complete", 2),
    codes = report("codes", 3);
  complete.metadata.diagnostic_result = { complete: true, codes: [] };
  codes.diagnostics = [
    { code: "p0121", description: "Código informado", status: "Pendente" },
  ];
  const cohort = summarizeRecordings([unknown, complete, codes]).cohorts[0];
  assert.deepEqual(cohort.dtc, {
    known_sessions: 1,
    unknown_sessions: 2,
    sessions_with_codes: 1,
    observed_codes: ["P0121"],
  });
});
