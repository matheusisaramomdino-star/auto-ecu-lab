/** Origem dos dados: coleta real, arquivo importado e simulação não se misturam. */
export const OPERATION_MODES = Object.freeze({
  simulation: {
    label: "Simulação / dados fictícios",
    badge: "DADOS FICTÍCIOS",
  },
  imported: { label: "Arquivo importado", badge: "CSV IMPORTADO" },
  real: { label: "Leitura real OBD-II", badge: "LEITURA REAL · OBD-II" },
});

export function operationMode(recording) {
  const declared = recording.metadata?.operation_mode;
  if (declared != null && !Object.hasOwn(OPERATION_MODES, declared))
    throw new Error("Modo de operação desconhecido.");
  if (recording.isDemo && declared && declared !== "simulation")
    throw new Error(
      "Dados fictícios não podem ser identificados como leitura real ou importação medida.",
    );
  if (!recording.isDemo && declared === "simulation")
    throw new Error(
      "Simulações devem manter a identificação de dados fictícios.",
    );
  return declared || (recording.isDemo ? "simulation" : "imported");
}

/** Só uma coleta explicitamente real, completa e ordenada entra na análise legada. */
export function completeRealSamples(frames) {
  if (!Array.isArray(frames) || frames.length < 2)
    throw new Error("Colete pelo menos duas amostras reais.");
  const samples = [];
  let previous = -1;
  for (const frame of frames) {
    if (!Number.isFinite(frame.time_s) || frame.time_s <= previous)
      throw new Error(
        "A aquisição real precisa de tempos crescentes, sem duplicatas.",
      );
    for (const key of ["pedal_pct", "throttle_pct", "rpm"])
      if (frame[key] == null || !Number.isFinite(frame[key]))
        throw new Error(
          "A coleta tem canais ausentes. Exporte o registro bruto; não preenchemos sinais com zero.",
        );
    samples.push({
      time_s: frame.time_s,
      pedal_pct: frame.pedal_pct,
      throttle_pct: frame.throttle_pct,
      rpm: frame.rpm,
    });
    previous = frame.time_s;
  }
  return samples;
}
