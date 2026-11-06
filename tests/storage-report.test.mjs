import test from "node:test";
import assert from "node:assert/strict";
import { parseBackup, stateJSON, validateBackup, loadState } from "../dist/store.mjs";
import { reportHtml, reportPayload, recordingCsv, simulationCsv } from "../dist/report.mjs";

function state() {
  const vehicle = { id: "v1", brand: "Fiat", model: "Strada", year: 2022, engine: "1.4", plate: "FICTÍCIO", ecu: { manufacturer: "", identification: "", hardware: "", software: "", source: "Não confirmada" } };
  const samples = Array.from({ length: 31 }, (_, i) => ({ time_s: i/10, pedal_pct: i>=10 ? 50:0, throttle_pct: i>=14 ? 40:5, rpm: i>=18 ? 1800:850 }));
  return { schemaVersion: 1, vehicles: [vehicle], recordings: [{ id: "r1", vehicleId: "v1", title: "Ensaio fictício", filename: "rasther.csv", createdAt: "2026-11-05T15:00:00Z", isDemo: true, vehicle: structuredClone(vehicle), samples, diagnostics: [], metadata: { source: "Fictício", mapping: { time_s: "Tempo" }, extra: { retained: true } }, analysisConfig: {} }], selectedId: "r1" };
}

test("backup round-trip preserva amostras, identidade e metadados sem referências compartilhadas", () => {
  const source = state();
  const backup = parseBackup(stateJSON(source));
  assert.equal(backup.recordings[0].metadata.extra.retained, true);
  assert.deepEqual(backup.recordings[0].samples, source.recordings[0].samples);
  assert.deepEqual(backup.recordings[0].vehicle, source.vehicles[0]);
  source.recordings[0].samples[0].rpm = 0;
  assert.equal(backup.recordings[0].samples[0].rpm, 850);
});

test("backup exige versão e vínculos válidos antes de substituir dados", () => {
  const wrongVersion = state(); wrongVersion.schemaVersion = 2;
  assert.throws(() => validateBackup(wrongVersion), /Versão/);
  const broken = state(); broken.recordings[0].vehicleId = "missing";
  assert.throws(() => validateBackup(broken), /vinculado/);
  const snapshot = state(); snapshot.recordings[0].vehicle.id = "other";
  assert.throws(() => validateBackup(snapshot), /outro veículo/);
  const duplicate = state(); duplicate.vehicles.push(structuredClone(duplicate.vehicles[0]));
  assert.throws(() => validateBackup(duplicate), /duplicados/);
});

test("backup rejeita CSV disfarçado, amostras inválidas e parâmetros não finitos", () => {
  assert.throws(() => parseBackup("tempo;pedal\n1;2"), /JSON inválido/);
  const invalid = state(); invalid.recordings[0].samples[1].time_s = 0;
  assert.throws(() => validateBackup(invalid));
  const nan = state(); nan.recordings[0].analysisConfig = { slow_threshold_s: NaN };
  assert.throws(() => validateBackup(nan), /não finito/);
  const badCode = state(); badCode.recordings[0].diagnostics = [{ code: "BAD", description: "Exemplo", status: "Ativo" }];
  assert.throws(() => validateBackup(badCode), /DTC inválido/);
});

test("backup rejeita seleção inexistente e metadados que poluiriam protótipos", () => {
  const selected = state(); selected.selectedId = "missing";
  assert.throws(() => validateBackup(selected), /selecionado/);
  const polluted = state(); polluted.recordings[0].metadata = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateBackup(polluted), /não permitida/);
  assert.equal({}.polluted, undefined);
});

test("armazenamento indisponível gera erro legível em vez de simular salvamento", async () => {
  await assert.rejects(loadState(), /armazenamento local/);
});

test("relatório mede atraso conhecido e guarda versão, critérios e dados fictícios", () => {
  const recording = state().recordings[0];
  const payload = reportPayload(recording);
  assert.equal(payload.application, "AUTO ECU LAB");
  assert.equal(payload.recording.is_demo, true);
  assert.equal(payload.analysis.median_throttle_delay_s, 0.4);
  assert.equal(payload.analysis.median_rpm_delay_s, 0.8);
  assert.ok(payload.analysis.config.slow_threshold_s > 0);
  assert.match(payload.limitations, /Sem gravação na ECU/);
});

test("HTML exportado escapa conteúdo não confiável e contém gráfico sem dependências remotas", () => {
  const recording = state().recordings[0];
  recording.title = '<img src=x onerror="alert(1)">';
  recording.vehicle.model = "<script>alert(1)</script>";
  const html = reportHtml(recording);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;img/);
  assert.match(html, /DADOS INTEIRAMENTE FICTÍCIOS/);
  assert.match(html, /<svg/);
  assert.equal((html.match(/<polyline/g) ?? []).length, 3);
  assert.match(html, /05\/11\/2026,? 11:00:00/);
  assert.ok(!html.includes('<script src='));
});

test("CSV mantém todas as amostras e separa modelo de medição com parâmetros", () => {
  const recording = state().recordings[0];
  const csv = recordingCsv(recording);
  assert.equal(csv[0], "\uFEFF");
  assert.equal(csv.trim().split(/\r?\n/).length, recording.samples.length + 1);
  const values = recording.samples.map(sample => ({ time_s: sample.time_s, simulated_throttle_pct: 30 }));
  const simulated = simulationCsv(recording, values, { delay_s: 0.15, tau_s: 0.25, gamma: 1, maximum_pct: 85 });
  assert.match(simulated, /borboleta_medida_pct/);
  assert.match(simulated, /borboleta_simulada_pct/);
  assert.match(simulated, /atraso_modelo_s/);
  assert.throws(() => simulationCsv(recording, [], {}), /quantidades diferentes/);
});
