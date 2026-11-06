/** Núcleo local do AUTO ECU LAB. Não usa rede, hardware ou bibliotecas externas. */

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export const ANALYSIS_DEFAULTS = Object.freeze({
  pedal_rise_pp: 10,
  throttle_rise_pp: 3,
  rpm_rise: 100,
  response_window_s: 3,
  slow_threshold_s: 0.5,
});

export const SIMULATION_DEFAULTS = Object.freeze({
  delay_s: 0.15,
  tau_s: 0.25,
  gamma: 1,
  maximum_pct: 85,
});

export const LIMITATIONS =
  "Análise exploratória de dados do scanner, sem diagnóstico conclusivo. " +
  "O atraso aparente inclui aquisição sequencial, resolução temporal e estratégia de controle. " +
  "Os limites configurados não são especificações Fiat ou Rasther. " +
  "Pedal e borboleta não têm relação obrigatória de 1:1. RPM depende de carga, marcha e condições do motor. " +
  "Esta análise não grava na ECU nem altera segurança ou emissões. Consultas reais de leitura ficam em uma área separada.";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 50000;
const SAMPLE_FIELDS = ["time_s", "pedal_pct", "throttle_pct", "rpm"];
const ALIASES = {
  time_s: [
    "time_s",
    "tempo_s",
    "tempo",
    "tempo_ms",
    "time_ms",
    "timestamp",
    "tempo_hh_mm_ss",
  ],
  pedal_pct: [
    "pedal_pct",
    "pedal",
    "pedal_do_acelerador",
    "posicao_do_pedal",
    "posicao_pedal",
  ],
  throttle_pct: [
    "throttle_pct",
    "borboleta",
    "abertura_da_borboleta",
    "posicao_da_borboleta",
    "abertura_borboleta",
  ],
  rpm: [
    "rpm",
    "rotacao",
    "rotacao_rpm",
    "rotacao_do_motor_rpm",
    "rotacao_do_motor",
  ],
};

const normalized = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const round = (value, digits) => Number(value.toFixed(digits));
const fail = (message) => {
  throw new ValidationError(message);
};

export function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length < 2)
    fail("São necessárias pelo menos duas amostras.");
  if (samples.length > MAX_ROWS) fail("Limite de 50.000 amostras excedido.");
  let previous = -1;
  samples.forEach((sample, index) => {
    const label = `Amostra ${index + 1}`;
    if (!sample || !SAMPLE_FIELDS.every((key) => Number.isFinite(sample[key])))
      fail(`${label}: valores devem ser finitos.`);
    if (sample.time_s < 0 || sample.time_s <= previous)
      fail(
        `${label}: tempo deve ser crescente, sem duplicatas e não negativo.`,
      );
    if (
      sample.pedal_pct < 0 ||
      sample.pedal_pct > 100 ||
      sample.throttle_pct < 0 ||
      sample.throttle_pct > 100
    )
      fail(`${label}: pedal e borboleta devem estar entre 0 e 100%.`);
    if (sample.rpm < 0 || sample.rpm > 15000)
      fail(`${label}: RPM fora do intervalo de importação (0–15000).`);
    previous = sample.time_s;
  });
}

export function decodeFile(arrayBuffer) {
  const bytes =
    arrayBuffer instanceof ArrayBuffer
      ? new Uint8Array(arrayBuffer)
      : arrayBuffer;
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.byteLength ||
    bytes.byteLength > MAX_BYTES
  )
    fail("Envie um CSV não vazio de até 5 MB.");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  if (/[\x00\ufffd]/.test(text))
    fail("Codificação inválida; salve o arquivo em UTF-8 ou Windows-1252.");
  return text.replace(/^\ufeff/, "");
}

function detectDelimiter(text) {
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (c === "\r" || c === "\n")) {
      break;
    } else if (!quoted && c in counts) counts[c]++;
  }
  const delimiter = Object.keys(counts).sort(
    (a, b) => counts[b] - counts[a],
  )[0];
  if (!counts[delimiter])
    fail("CSV inválido. Use separador ponto e vírgula, vírgula ou tabulação.");
  return delimiter;
}

/** CSV com aspas escapadas e campos multilinha; linhas incompletas são rejeitadas. */
function readTable(input) {
  if (typeof input !== "string" || !input.length || input.length > MAX_BYTES)
    fail("Envie um CSV não vazio de até 5 MB.");
  const text = input.replace(/^\ufeff/, "");
  if (/[\x00\ufffd]/.test(text))
    fail("Codificação inválida; salve o arquivo em UTF-8 ou Windows-1252.");
  const delimiter = detectDelimiter(text);
  const rows = [];
  let fields = [],
    field = "",
    quoted = false,
    closed = false,
    line = 1,
    recordHasData = false;
  const pushField = () => {
    fields.push(field);
    field = "";
    closed = false;
  };
  const pushRow = () => {
    if (recordHasData || fields.length || field.length) {
      pushField();
      rows.push({ line, fields });
      if (rows.length > MAX_ROWS + 1) fail("Limite de 50.000 linhas excedido.");
    }
    fields = [];
    field = "";
    closed = false;
    recordHasData = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += c;
        if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
      }
      continue;
    }
    if (c === delimiter) {
      pushField();
      recordHasData = true;
    } else if (c === "\n" || c === "\r") {
      pushRow();
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++;
    } else if (c === '"' && !field.length && !closed) {
      quoted = true;
      recordHasData = true;
    } else {
      if (closed && !/\s/.test(c))
        fail(`Linha ${line}: conteúdo inesperado depois de aspas.`);
      if (!closed) field += c;
      recordHasData = true;
    }
  }
  if (quoted) fail(`Linha ${line}: campo entre aspas não foi encerrado.`);
  pushRow();
  if (!rows.length) fail("Cabeçalho vazio ou inválido.");
  const headers = rows.shift().fields.map((h) => h.trim());
  if (headers.some((h) => !h)) fail("Cabeçalho vazio ou inválido.");
  if (new Set(headers.map(normalized)).size !== headers.length)
    fail("Existem colunas duplicadas no cabeçalho.");
  if (!rows.length) fail("O CSV não contém dados.");
  for (const row of rows) {
    if (row.fields.length !== headers.length)
      fail(`Linha ${row.line}: quantidade de campos diferente do cabeçalho.`);
  }
  return { headers, rows, delimiter };
}

function numeric(value) {
  const text = String(value).trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text))
    throw new Error("Número inválido");
  const result = Number(text.replace(",", "."));
  if (!Number.isFinite(result)) throw new Error("Número não finito");
  return result;
}

function timeValue(value, header, unit) {
  if (value.includes(":")) {
    const parts = value.trim().split(":");
    if (parts.length !== 3) throw new Error("Use HH:MM:SS.sss");
    const [hours, minutes, seconds] = parts.map(numeric);
    if (
      hours < 0 ||
      !Number.isInteger(hours) ||
      minutes < 0 ||
      minutes >= 60 ||
      !Number.isInteger(minutes) ||
      seconds < 0 ||
      seconds >= 60
    )
      throw new Error("Horário inválido");
    return hours * 3600 + minutes * 60 + seconds;
  }
  return (
    numeric(value) /
    (unit === "ms" ||
    (unit === "auto" && ["tempo_ms", "time_ms"].includes(normalized(header)))
      ? 1000
      : 1)
  );
}

export function parseSignals(text, mapping = {}, timeUnit = "auto") {
  const { headers, rows, delimiter } = readTable(text);
  if (!["auto", "s", "ms"].includes(timeUnit))
    fail("Unidade de tempo inválida.");
  const resolved = {},
    indices = {};
  for (const key of SAMPLE_FIELDS) {
    const explicit = String(mapping[key] || "").trim();
    const candidates = headers.filter((h) =>
      ALIASES[key].includes(normalized(h)),
    );
    if (explicit) {
      if (!headers.includes(explicit))
        fail(`Coluna '${explicit}' não encontrada.`);
      resolved[key] = explicit;
    } else if (candidates.length === 1) resolved[key] = candidates[0];
    else
      fail(
        `Mapeie a coluna ${key}; colunas disponíveis: ${headers.join(", ")}.`,
      );
    indices[key] = headers.indexOf(resolved[key]);
  }
  if (new Set(Object.values(resolved)).size !== 4)
    fail(
      "Selecione quatro colunas diferentes para tempo, pedal, borboleta e RPM.",
    );
  const samples = rows.map(({ line, fields }) => {
    try {
      return {
        time_s: timeValue(fields[indices.time_s], resolved.time_s, timeUnit),
        pedal_pct: numeric(fields[indices.pedal_pct]),
        throttle_pct: numeric(fields[indices.throttle_pct]),
        rpm: numeric(fields[indices.rpm]),
      };
    } catch {
      fail(
        `Linha ${line}: número ou tempo inválido. Não use unidades dentro das células.`,
      );
    }
  });
  validateSamples(samples);
  return { samples, mapping: resolved, delimiter };
}

export function parseDiagnostics(text) {
  const { headers, rows } = readTable(text);
  const names = headers.map(normalized);
  const indices = [
    ["codigo", "dtc", "code"],
    ["descricao", "description"],
    ["status", "estado"],
  ].map((aliases) => names.findIndex((name) => aliases.includes(name)));
  if (indices.some((index) => index < 0))
    fail("Relatório DTC exige colunas: codigo;descricao;status.");
  return rows.map(({ line, fields }) => {
    const [code, description, status] = indices.map((index) =>
      fields[index].trim(),
    );
    if (!/^[PCBU][0-3][0-9A-F]{3}$/i.test(code))
      fail(`Linha ${line}: código DTC inválido (exemplo: P0121).`);
    if (
      !description ||
      !status ||
      description.length > 1000 ||
      status.length > 100
    )
      fail(
        `Linha ${line}: informe descrição (até 1000 caracteres) e status (até 100).`,
      );
    return { code: code.toUpperCase(), description, status };
  });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

function upperBound(values, value) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Árvore de extremos: encontra o primeiro cruzamento sem percorrer janelas densas. */
function thresholdIndex(values, minimum) {
  let size = 1;
  while (size < values.length) size *= 2;
  const tree = new Float64Array(size * 2);
  tree.fill(minimum ? Infinity : -Infinity);
  values.forEach((value, index) => {
    tree[size + index] = value;
  });
  const combine = minimum ? Math.min : Math.max;
  for (let index = size - 1; index > 0; index--)
    tree[index] = combine(tree[index * 2], tree[index * 2 + 1]);
  return (from, through, threshold) => {
    function search(node, left, right) {
      if (
        right < from ||
        left > through ||
        (minimum ? tree[node] >= threshold : tree[node] < threshold)
      )
        return -1;
      if (left === right) return left < values.length ? left : -1;
      const middle = Math.floor((left + right) / 2);
      const first = search(node * 2, left, middle);
      return first >= 0 ? first : search(node * 2 + 1, middle + 1, right);
    }
    return through < from ? -1 : search(1, 0, size - 1);
  };
}

function configured(defaults, supplied) {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied))
    fail("Configuração inválida.");
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      supplied[key] === undefined ? value : supplied[key],
    ]),
  );
}

export function analyze(samples, diagnostics = [], suppliedConfig = {}) {
  validateSamples(samples);
  const config = configured(ANALYSIS_DEFAULTS, suppliedConfig);
  if (
    !Object.values(config).every((value) => Number.isFinite(value) && value > 0)
  )
    fail("Parâmetros da análise devem ser positivos e finitos.");
  if (config.pedal_rise_pp > 100 || config.throttle_rise_pp > 100)
    fail("Variações percentuais não podem exceder 100 pontos percentuais.");
  const intervals = samples
    .slice(1)
    .map((sample, index) => sample.time_s - samples[index].time_s);
  const dt = median(intervals),
    gapLimit = Math.max(0.5, dt * 3);
  const times = samples.map((s) => s.time_s);
  const gapPrefix = new Uint32Array(samples.length);
  for (let i = 1; i < samples.length; i++)
    gapPrefix[i] = gapPrefix[i - 1] + (intervals[i - 1] > gapLimit ? 1 : 0);
  const firstRelease = thresholdIndex(
    samples.map((s) => s.pedal_pct),
    true,
  );
  const firstThrottle = thresholdIndex(
    samples.map((s) => s.throttle_pct),
    false,
  );
  const firstRpm = thresholdIndex(
    samples.map((s) => s.rpm),
    false,
  );
  const events = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].pedal_pct - samples[i - 1].pedal_pct < 0.5) continue;
    const start = i,
      baseline = samples[start - 1];
    while (
      i + 1 < samples.length &&
      samples[i + 1].pedal_pct - samples[i].pedal_pct > 0.2
    )
      i++;
    const rise = samples[i].pedal_pct - baseline.pedal_pct;
    if (rise < config.pedal_rise_pp) continue;
    const onset = samples[start].time_s;
    let end = Math.min(onset + config.response_window_s, samples.at(-1).time_s);
    let finalIndex = upperBound(times, end) - 1;
    const release = firstRelease(
      i + 1,
      finalIndex,
      baseline.pedal_pct + rise * 0.3,
    );
    if (release >= 0) {
      end = times[release];
      finalIndex = release - 1;
    }
    const usable =
      finalIndex >= start && gapPrefix[finalIndex] === gapPrefix[start - 1];
    const delay = (find, threshold) => {
      const index = usable ? find(start, finalIndex, threshold) : -1;
      return index < 0 ? null : round(times[index] - onset, 6);
    };
    events.push({
      time_s: onset,
      pedal_rise_pp: round(rise, 3),
      throttle_delay_s: delay(
        firstThrottle,
        baseline.throttle_pct + config.throttle_rise_pp,
      ),
      rpm_delay_s: delay(firstRpm, baseline.rpm + config.rpm_rise),
      end_s: end,
      usable,
    });
  }
  const extrema = (values) =>
    values.reduce(
      ([minimum, maximum], value) => [
        Math.min(minimum, value),
        Math.max(maximum, value),
      ],
      [Infinity, -Infinity],
    );
  const [minInterval, maxInterval] = extrema(intervals);
  const rpmRange = extrema(samples.map((s) => s.rpm));
  const findings = [];
  const finding = (code, level, title, evidence, recommendation) =>
    findings.push({ code, level, title, evidence, recommendation });
  if (dt > 0.2)
    finding(
      "BAIXA_RESOLUCAO",
      "info",
      "Amostragem lenta",
      `Intervalo mediano de ${dt.toFixed(3)} s.`,
      "Atrasos menores que a amostragem não podem ser distinguidos; reduza a quantidade de parâmetros no scanner.",
    );
  if (maxInterval > gapLimit || maxInterval - minInterval > dt * 0.2)
    finding(
      "AMOSTRAGEM_IRREGULAR",
      "attention",
      "Tempo de aquisição irregular",
      `Intervalos entre ${minInterval.toFixed(3)} e ${maxInterval.toFixed(3)} s; eventos com lacunas são excluídos.`,
      "Confira timestamps e a aquisição sequencial dos canais pelo scanner.",
    );
  if (!events.length)
    finding(
      "SEM_EVENTOS",
      "info",
      "Sem acionamentos suficientes",
      `Nenhuma subida contínua do pedal de pelo menos ${config.pedal_rise_pp} pp.`,
      "Use um registro com acionamentos e retornos do pedal; ausência de evento não comprova funcionamento normal.",
    );
  const slow = events.filter(
    (e) =>
      e.throttle_delay_s !== null &&
      e.throttle_delay_s > config.slow_threshold_s,
  );
  const missing = events.filter((e) => e.usable && e.throttle_delay_s === null);
  if (slow.length)
    finding(
      "RESPOSTA_LENTA",
      "attention",
      "Possível demora de resposta",
      `${slow.length} evento(s) acima do limite exploratório de ${config.slow_threshold_s} s.`,
      "Correlacione carga, tensão, DTCs e estratégia de torque. O atraso isolado não identifica componente defeituoso.",
    );
  if (missing.length)
    finding(
      "RESPOSTA_AUSENTE",
      "attention",
      "Sem resposta observável da borboleta",
      `${missing.length} evento(s) sem aumento de ${config.throttle_rise_pp} pp na janela disponível.`,
      "Confira se a janela terminou cedo, o significado/unidade do PID e condições do ensaio antes de investigar atuador ou sensor.",
    );
  if (rpmRange[1] === 0)
    finding(
      "MOTOR_PARADO",
      "info",
      "RPM igual a zero em todo o registro",
      "Não há rotação registrada.",
      "Verifique se o ensaio foi feito com motor parado; não conclua falha mecânica a partir desse registro.",
    );
  for (const dtc of diagnostics)
    finding(
      dtc.code,
      "attention",
      `DTC informado: ${dtc.code}`,
      `${dtc.description} · ${dtc.status}`,
      "Consulte o procedimento do fabricante e confirme o estado do código no scanner. Código importado não é diagnóstico conclusivo.",
    );
  const delayMedian = (key) => {
    const values = events
      .map((event) => event[key])
      .filter((value) => value !== null);
    return values.length ? median(values) : null;
  };
  return {
    duration_s: samples.at(-1).time_s - samples[0].time_s,
    sample_count: samples.length,
    interval_s: dt,
    min_interval_s: minInterval,
    max_interval_s: maxInterval,
    pedal_range: extrema(samples.map((s) => s.pedal_pct)),
    throttle_range: extrema(samples.map((s) => s.throttle_pct)),
    rpm_range: rpmRange,
    median_throttle_delay_s: delayMedian("throttle_delay_s"),
    median_rpm_delay_s: delayMedian("rpm_delay_s"),
    events,
    findings,
    config,
  };
}

export function simulate(samples, suppliedConfig = {}) {
  validateSamples(samples);
  const config = configured(SIMULATION_DEFAULTS, suppliedConfig);
  if (!Object.values(config).every(Number.isFinite))
    fail("Parâmetros da simulação devem ser finitos.");
  if (
    config.delay_s < 0 ||
    config.delay_s > 3 ||
    config.tau_s < 0.02 ||
    config.tau_s > 3
  )
    fail("Atraso: 0–3 s. Constante de tempo: 0,02–3 s.");
  if (
    config.gamma < 0.3 ||
    config.gamma > 3 ||
    config.maximum_pct < 1 ||
    config.maximum_pct > 100
  )
    fail("Curva: 0,3–3. Abertura máxima: 1–100%.");
  const times = samples.map((s) => s.time_s),
    changes = times.map((time) => time + config.delay_s);
  let value = Math.min(
      config.maximum_pct,
      Math.max(0, samples[0].throttle_pct),
    ),
    previous = times[0];
  const output = [
    { time_s: previous, simulated_throttle_pct: round(value, 5) },
  ];
  for (let i = 1; i < samples.length; i++) {
    const endTime = times[i],
      lastChange = upperBound(changes, endTime);
    const integrate = (end) => {
      const index = Math.max(
        0,
        upperBound(times, previous - config.delay_s + 1e-10) - 1,
      );
      const target =
        config.maximum_pct * (samples[index].pedal_pct / 100) ** config.gamma;
      value =
        target + (value - target) * Math.exp(-(end - previous) / config.tau_s);
      previous = end;
    };
    for (
      let change = upperBound(changes, previous);
      change < lastChange;
      change++
    ) {
      if (changes[change] < endTime) integrate(changes[change]);
    }
    integrate(endTime);
    output.push({
      time_s: endTime,
      simulated_throttle_pct: round(Math.min(100, Math.max(0, value)), 5),
    });
  }
  return output;
}

/** CSV de planilha com BOM, separador ; e proteção contra fórmulas em texto. */
export function csvEncode(headers, rows) {
  const cell = (input) => {
    let value = String(input ?? "");
    if (typeof input === "string" && /^[=+\-@]/.test(input.trimStart()))
      value = "'" + value;
    return /[;"\r\n]/.test(value)
      ? '"' + value.replaceAll('"', '""') + '"'
      : value;
  };
  return (
    "\ufeff" +
    [headers, ...rows].map((row) => row.map(cell).join(";")).join("\r\n") +
    "\r\n"
  );
}
