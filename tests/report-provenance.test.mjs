import test from "node:test";
import assert from "node:assert/strict";
import { reportHtml, reportPayload } from "../dist/report.mjs";

function recording() {
  return {
    id: "teste-relatorio",
    vehicleId: "v1",
    isDemo: false,
    title: "Teste de rastreabilidade",
    filename: "scanner.csv",
    createdAt: "2026-11-06T13:00:00Z",
    vehicle: {
      id: "v1",
      brand: "Fiat",
      model: "Strada",
      year: 2022,
      engine: "1.4",
      ecu: {},
    },
    samples: Array.from({ length: 31 }, (_, index) => ({
      time_s: index / 10,
      pedal_pct: index >= 2 ? 40 : 0,
      throttle_pct: index >= 6 ? 35 : 5,
      rpm: index >= 7 ? 1400 : 850,
    })),
    diagnostics: [],
    analysisConfig: {},
    metadata: { operation_mode: "imported" },
  };
}

test("relatório individual não verificado mantém análise e explica exclusão da base real", () => {
  const value = recording(),
    payload = reportPayload(value),
    html = reportHtml(value);
  assert.equal(payload.provenance_status.eligible, false);
  assert.equal(payload.analysis.median_throttle_delay_s, 0.4);
  assert.match(html, /Excluído das estatísticas da base real/);
  assert.match(html, /Proveniência ausente/);
  assert.match(html, /SHA-256: <code>Não disponível<\/code>/);
  assert.doesNotMatch(html, /Demonstração sintética \/ não disponível/);
  assert.doesNotMatch(html, /DADOS INTEIRAMENTE FICTÍCIOS/);
});

test("relatório de origem confirmada mostra fonte, data, referência e hash da proveniência", () => {
  const value = recording();
  value.metadata.provenance = {
    schema_version: 1,
    kind: "scanner_report",
    source: "Scanner <origem>",
    verification: "operator_confirmed",
    captured_at: "2026-11-06T10:00:00-03:00",
    reference: "ordem <123>",
    sha256: "a".repeat(64),
  };
  const payload = reportPayload(value),
    html = reportHtml(value);
  assert.equal(payload.provenance_status.eligible, true);
  assert.equal(payload.provenance_status.kind, "scanner_report");
  assert.deepEqual(
    payload.recording.metadata.provenance,
    value.metadata.provenance,
  );
  assert.match(html, /Origem elegível para estatísticas da base real/);
  assert.match(html, /Scanner &lt;origem&gt;/);
  assert.match(html, /ordem &lt;123&gt;/);
  assert.match(html, /2026-11-06T10:00:00-03:00/);
  assert.match(html, new RegExp(`SHA-256: <code>${"a".repeat(64)}<\\/code>`));
  assert.doesNotMatch(html, /Excluído das estatísticas/);
});
