import test from "node:test";
import assert from "node:assert/strict";
import { operationMode, completeRealSamples } from "../dist/modes.mjs";

test("backups antigos mantêm a origem importada e fictícia sem alegar coleta real", () => {
  assert.equal(operationMode({ isDemo: true, metadata: {} }), "simulation");
  assert.equal(operationMode({ isDemo: false, metadata: {} }), "imported");
  assert.equal(
    operationMode({ isDemo: false, metadata: { operation_mode: "real" } }),
    "real",
  );
});
test("identificação contraditória é rejeitada antes de persistir ou relatar", () => {
  assert.throws(() =>
    operationMode({ isDemo: true, metadata: { operation_mode: "real" } }),
  );
  assert.throws(() =>
    operationMode({
      isDemo: false,
      metadata: { operation_mode: "simulation" },
    }),
  );
  assert.throws(() =>
    operationMode({ isDemo: false, metadata: { operation_mode: "unknown" } }),
  );
});
test("canais ausentes nunca são forjados para alimentar a análise", () => {
  const frames = [
    { time_s: 0, pedal_pct: null, throttle_pct: 5, rpm: 850 },
    { time_s: 1, pedal_pct: null, throttle_pct: 10, rpm: 900 },
  ];
  assert.throws(() => completeRealSamples(frames), /ausentes/);
  assert.throws(
    () => completeRealSamples([{ ...frames[0], pedal_pct: 0 }]),
    /duas/,
  );
});
test("amostras reais completas preservam zero válido, dados e ordem temporal", () => {
  const frames = [
    { time_s: 0, pedal_pct: 0, throttle_pct: 5, rpm: 0, ecuId: "7E8" },
    { time_s: 1, pedal_pct: 20, throttle_pct: 10, rpm: 900, ecuId: "7E8" },
  ];
  const samples = completeRealSamples(frames);
  assert.equal(samples[0].rpm, 0);
  assert.equal(samples[0].pedal_pct, 0);
  assert.equal(frames[0].ecuId, "7E8");
  assert.notEqual(samples[0], frames[0]);
  assert.throws(
    () => completeRealSamples([frames[1], frames[0]]),
    /crescentes/,
  );
});
