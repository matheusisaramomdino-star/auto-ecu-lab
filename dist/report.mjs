import { analyze, csvEncode } from "./core.mjs";
import { operationMode, OPERATION_MODES } from "./modes.mjs";
import { APP_VERSION } from "./modules.mjs";
import { provenanceStatus } from "./statistics.mjs";

export const LIMITATIONS =
  "Análise exploratória, sem diagnóstico conclusivo. O atraso aparente inclui resolução e aquisição sequencial do scanner e a estratégia de controle. Os limites não são especificações dos fabricantes. Pedal e borboleta não têm relação obrigatória de 1:1. RPM depende de carga, marcha e condições do motor. A operação real usa consultas de leitura OBD-II em uma área separada. Sem gravação na ECU; não altera sistemas de segurança ou emissões.";
export const METHOD =
  "A primeira amostra de uma subida contínua do pedal inicia o evento. A resposta é a primeira ultrapassagem da base da borboleta/RPM mais o limiar configurado. Atrasos não são interpolados; eventos com lacunas são excluídos. A janela termina ao soltar o pedal, no limite configurado ou no fim do arquivo.";

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

function number(value, digits = 2) {
  return value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("pt-BR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}

function localDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.valueOf())
    ? `${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Manaus", dateStyle: "short", timeStyle: "medium" }).format(date)} · Manaus (UTC−4)`
    : "Não informada";
}

export function reportPayload(recording) {
  const result = analyze(
    recording.samples,
    recording.diagnostics ?? [],
    recording.analysisConfig ?? {},
  );
  return {
    application: "AUTO ECU LAB",
    workshop: "Auto Elétrica Doidinho",
    version: APP_VERSION + "-pwa",
    operation_mode: operationMode(recording),
    provenance_status: provenanceStatus(recording),
    generated_at_utc: new Date().toISOString(),
    recording: {
      id: recording.id,
      title: recording.title,
      filename: recording.filename,
      created_at: recording.createdAt,
      is_demo: recording.isDemo,
      metadata: structuredClone(recording.metadata ?? {}),
    },
    vehicle: structuredClone(recording.vehicle),
    analysis: result,
    diagnostics: structuredClone(recording.diagnostics ?? []),
    limitations: LIMITATIONS,
    method: METHOD,
  };
}

function chart(samples) {
  const width = 1000,
    left = 55,
    right = 60,
    top = 30,
    bottom = 285;
  const first = samples[0].time_s,
    last = samples.at(-1).time_s;
  const maximumRpm = Math.max(
    1000,
    Math.ceil(
      samples.reduce((maximum, sample) => Math.max(maximum, sample.rpm), 0) /
        1000,
    ) * 1000,
  );
  const indices = [];
  for (
    let i = 0;
    i < samples.length;
    i += Math.max(1, Math.ceil(samples.length / 1800))
  )
    indices.push(i);
  if (indices.at(-1) !== samples.length - 1) indices.push(samples.length - 1);
  const x = (value) =>
    left + ((value - first) / (last - first)) * (width - left - right);
  const y = (value) => bottom - (value / 100) * (bottom - top);
  const lines = [
    ["pedal_pct", "#c76500"],
    ["throttle_pct", "#242424"],
    ["rpm", "#808080"],
  ]
    .map(([key, color]) => {
      const points = indices
        .map(
          (i) =>
            `${x(samples[i].time_s).toFixed(2)},${y(key === "rpm" ? (samples[i].rpm / maximumRpm) * 100 : samples[i][key]).toFixed(2)}`,
        )
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`;
    })
    .join("");
  let ticks = "";
  for (let tick = 0; tick <= 100; tick += 20) {
    ticks += `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e5ebef"/><text x="45" y="${y(tick) + 4}" text-anchor="end">${tick}%</text><text x="950" y="${y(tick) + 4}">${Math.round((tick / 100) * maximumRpm)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 330" role="img" aria-label="Pedal e borboleta em porcentagem no eixo esquerdo e RPM no eixo direito; tempo em segundos"><rect width="100%" height="100%" fill="#f6f9fb"/>${ticks}<text x="950" y="15">RPM</text>${lines}<text x="55" y="310">${number(first)} s</text><text x="890" y="310">${number(last)} s</text><text x="470" y="325">Tempo (s)</text></svg>`;
}

export function reportHtml(recording) {
  const payload = reportPayload(recording),
    result = payload.analysis,
    vehicle = recording.vehicle,
    ecu = vehicle.ecu ?? {};
  const escape = escapeHtml;
  const findings = result.findings
    .map(
      (finding) =>
        `<article><h3>${escape(finding.title)} <small>[${escape(finding.code)}]</small></h3><p>${escape(finding.evidence)}</p><p>${escape(finding.recommendation)}</p></article>`,
    )
    .join("");
  const events = result.events
    .map(
      (event, i) =>
        `<tr><td>${i + 1}</td><td>${number(event.time_s, 3)}</td><td>${number(event.end_s, 3)}</td><td>${number(event.pedal_rise_pp, 1)}</td><td>${number(event.throttle_delay_s, 3)}</td><td>${number(event.rpm_delay_s, 3)}</td><td>${event.usable ? "Utilizável" : "Excluído: lacuna"}</td></tr>`,
    )
    .join("");
  const mapping = Object.entries(recording.metadata?.mapping ?? {})
    .map(([key, value]) => `${escape(key)} → ${escape(value)}`)
    .join("; ");
  const diagnosticProvenance = recording.metadata?.diagnostic_report;
  const provenance = recording.metadata?.provenance ?? {};
  const eligibility = payload.provenance_status;
  const originNotice = eligibility.eligible
    ? "Origem elegível para estatísticas da base real. A inclusão considera duplicatas e compatibilidade da coorte."
    : `Excluído das estatísticas da base real: ${eligibility.reason} A análise individual permanece disponível; a origem não foi validada para a base real.`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AUTO ECU LAB · ${escape(recording.title)}</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#242424;max-width:1000px;margin:40px auto;padding:0 22px}h1,h2,h3{color:#141414}h1{font-size:28px}h2{font-size:20px;border-bottom:1px solid #ddd;padding-bottom:8px;margin-top:30px}h3{font-size:15px}.label{color:#b25f00;font-weight:700;letter-spacing:2px}.notice{padding:15px;background:#fff1d7}.limits{padding:15px;background:#eff5f7}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:9px;text-align:left;border-bottom:1px solid #ddd}.table-wrap{overflow:auto}svg{width:100%;height:auto}svg text{font:11px system-ui,sans-serif;fill:#576a77}code{overflow-wrap:anywhere}article{break-inside:avoid}p,td{overflow-wrap:anywhere}.legend{font-size:12px}.muted{color:#617584}small{font-weight:400}@media print{body{margin:0;padding:0}h2{break-after:avoid}}</style></head><body>
  <div class="label">AUTO ECU LAB — Auto Elétrica Doidinho · RELATÓRIO EXPLORATÓRIO</div><h1>${escape(recording.title)}</h1><p><strong>Modo de operação: ${escape(OPERATION_MODES[payload.operation_mode].label)}</strong></p><p class="notice">${escape(originNotice)}</p><p class="muted">Ensaio ${escape(recording.id)} · Gerado em ${escape(localDate(payload.generated_at_utc))} · v${payload.version}</p>
  ${recording.isDemo ? '<p class="notice"><strong>DADOS INTEIRAMENTE FICTÍCIOS.</strong> Não representam medições reais de uma Fiat Strada ou de qualquer ECU.</p>' : ""}
  <h2>Veículo e identificação da ECU</h2><p>${escape(vehicle.brand)} ${escape(vehicle.model)} ${escape(vehicle.year)} · Motor ${escape(vehicle.engine)} · ${escape(vehicle.plate || "Placa não informada")}</p><p>ECU: ${escape(ecu.identification || "Não confirmada")} · Fabricante: ${escape(ecu.manufacturer || "Não informado")}<br>HW: ${escape(ecu.hardware || "—")} · SW: ${escape(ecu.software || "—")} · Origem: ${escape(ecu.source || "Não confirmada")}</p>
  <h2>Aquisição e resultados</h2><p>${result.sample_count} amostras · Duração ${number(result.duration_s)} s · Intervalo mediano ${number(result.interval_s, 3)} s (mín. ${number(result.min_interval_s, 3)}, máx. ${number(result.max_interval_s, 3)})</p><p>Medianas de atraso: borboleta ${number(result.median_throttle_delay_s, 3)} s · RPM ${number(result.median_rpm_delay_s, 3)} s. “—” significa que não há medição observável.</p>${chart(recording.samples)}<p class="legend"><span style="color:#0b8a73">━ Pedal (%)</span> · <span style="color:#ba7813">━ Borboleta (%)</span> · <span style="color:#7c78b2">━ RPM</span></p>
  <div class="table-wrap"><table><thead><tr><th>Evento</th><th>Início (s)</th><th>Fim (s)</th><th>Subida (pp)</th><th>Atraso borboleta (s)</th><th>Atraso RPM (s)</th><th>Qualidade</th></tr></thead><tbody>${events || '<tr><td colspan="7">Nenhum evento pelos critérios atuais.</td></tr>'}</tbody></table></div>
  <h2>Observações e possíveis falhas</h2>${findings || "<p>Sem indícios pelos critérios aplicados. Isso não confirma ausência de falhas.</p>"}
  <h2>Método e parâmetros</h2><p>${escape(METHOD)}</p><p>Subida mínima do pedal ${number(result.config.pedal_rise_pp, 1)} pp · Resposta da borboleta ${number(result.config.throttle_rise_pp, 1)} pp · Resposta do motor ${number(result.config.rpm_rise, 0)} RPM · Janela máxima ${number(result.config.response_window_s, 2)} s · Limite exploratório ${number(result.config.slow_threshold_s, 2)} s.</p>
  <h2>Rastreabilidade</h2><p>Arquivo: ${escape(recording.filename || "Não disponível")}<br>Registrado no aplicativo em: ${escape(localDate(recording.createdAt))}<br>Fonte: ${escape(provenance.source || recording.metadata?.source || "Não disponível")}<br>Aquisição na origem: <code>${escape(provenance.captured_at || "Não disponível")}</code><br>Referência na origem: ${escape(provenance.reference || "Não disponível")}<br>SHA-256: <code>${escape(recording.metadata?.sha256 || provenance.sha256 || "Não disponível")}</code></p><p>Colunas: ${mapping || "Não informado"}</p>${diagnosticProvenance ? `<p>Relatório DTC: ${escape(diagnosticProvenance.filename || "Não disponível")}<br>SHA-256 DTC: <code>${escape(diagnosticProvenance.sha256 || "Não disponível")}</code></p>` : ""}
  <h2>Limitações</h2><p class="limits">${escape(LIMITATIONS)}</p><p>O gráfico pode reduzir pontos para visualização; os cálculos e o CSV usam todas as amostras.</p><p>Abra este HTML no navegador e use Imprimir → Salvar como PDF. O documento e o gráfico funcionam sem internet.</p></body></html>`;
}

function withBOM(csv) {
  return csv.startsWith("\uFEFF") ? csv : "\uFEFF" + csv;
}

export function recordingCsv(recording) {
  return withBOM(
    csvEncode(
      ["tempo_s", "pedal_pct", "throttle_pct", "rpm"],
      recording.samples.map((sample) => [
        sample.time_s,
        sample.pedal_pct,
        sample.throttle_pct,
        sample.rpm,
      ]),
    ),
  );
}

export function simulationCsv(recording, values, config) {
  if (values.length !== recording.samples.length)
    throw new Error(
      "Simulação e dados medidos têm quantidades diferentes de amostras.",
    );
  return withBOM(
    csvEncode(
      [
        "tempo_s",
        "pedal_pct",
        "borboleta_medida_pct",
        "borboleta_simulada_pct",
        "rpm_medido",
        "atraso_modelo_s",
        "tau_modelo_s",
        "expoente_modelo",
        "abertura_maxima_modelo_pct",
      ],
      recording.samples.map((sample, index) => [
        sample.time_s,
        sample.pedal_pct,
        sample.throttle_pct,
        values[index].simulated_throttle_pct,
        sample.rpm,
        config.delay_s,
        config.tau_s,
        config.gamma,
        config.maximum_pct,
      ]),
    ),
  );
}
