/** Bancada local de bytes. Não conecta hardware, edita ou exporta firmware. */
import {
  BINARY_TYPES,
  MAX_BINARY_BYTES,
  inspectBinary,
  readTable,
} from "./binary.mjs";
import { escapeHtml as h } from "./report.mjs";

const fmt = (value) =>
  Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 5 });
const hex = (value) => "0x" + value.toString(16).toUpperCase().padStart(4, "0");
const DEFAULTS = Object.freeze({
  offset: "0",
  rows: 8,
  columns: 8,
  type: "uint8",
  endian: "little",
});

/** SVGs só recebem números já validados por readTable(). Eixos são índices. */
export function binaryLineSvg(table, row = 0) {
  if (!Number.isInteger(row) || row < 0 || row >= table.rows)
    throw new Error("Linha inválida.");
  const values = table.values[row],
    width = 720,
    height = 260;
  const low = table.min,
    span = table.max - low || 1;
  const x = (i) => 58 + (i / Math.max(1, values.length - 1)) * 630;
  const y = (v) => 208 - ((v - low) / span) * 168;
  const points = values
    .map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`)
    .join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Valores brutos da linha ${row}, por índice de coluna" style="width:100%;height:auto"><path d="M58 32V208H692" fill="none" stroke="#858585"/><text x="10" y="24" fill="#fff" font-size="12">${h(fmt(table.max))}</text><text x="10" y="212" fill="#fff" font-size="12">${h(fmt(table.min))}</text><polyline points="${points}" fill="none" stroke="#FF8A00" stroke-width="2.5"/>${values.map((v, i) => `<circle cx="${x(i).toFixed(2)}" cy="${y(v).toFixed(2)}" r="3" fill="#FF8A00"><title>Coluna ${i}: ${h(fmt(v))}</title></circle>`).join("")}<text x="58" y="230" fill="#bbb" font-size="12">0</text><text x="680" y="230" fill="#bbb" font-size="12">${values.length - 1}</text><text x="310" y="250" fill="#bbb" font-size="12">Índice da coluna · valores brutos</text></svg>`;
}

export function binarySurfaceSvg(table, angle = 35) {
  if (!Number.isFinite(angle) || angle < -180 || angle > 180)
    throw new Error("Ângulo inválido.");
  const radians = (angle * Math.PI) / 180;
  const raw = [],
    span = table.max - table.min || 1;
  const project = (r, c, v) => {
    const x = (c / Math.max(1, table.columns - 1) - 0.5) * 2;
    const y = (r / Math.max(1, table.rows - 1) - 0.5) * 2;
    const rotatedX = x * Math.cos(radians) - y * Math.sin(radians);
    const depth = x * Math.sin(radians) + y * Math.cos(radians);
    const z = (v - table.min) / span;
    return { x: 360 + rotatedX * 160, y: 220 + depth * 57 - z * 120, depth, z };
  };
  const point = (v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
  for (let r = 0; r < table.rows - 1; r++)
    for (let c = 0; c < table.columns - 1; c++) {
      const points = [
        project(r, c, table.values[r][c]),
        project(r, c + 1, table.values[r][c + 1]),
        project(r + 1, c + 1, table.values[r + 1][c + 1]),
        project(r + 1, c, table.values[r + 1][c]),
      ];
      raw.push({
        points,
        depth: points.reduce((sum, p) => sum + p.depth, 0) / 4,
        r,
        c,
      });
    }
  raw.sort((a, b) => a.depth - b.depth);
  const mesh = raw
    .map(
      ({ points, r, c }) =>
        `<polygon points="${points.map(point).join(" ")}" fill="#FF8A00" fill-opacity="${(0.15 + (points.reduce((sum, p) => sum + p.z, 0) / 4) * 0.55).toFixed(3)}" stroke="#FF8A00" stroke-width=".7"><title>Recorte entre linhas ${r}–${r + 1} e colunas ${c}–${c + 1}</title></polygon>`,
    )
    .join("");
  const rows = table.values
    .map(
      (values, r) =>
        `<polyline points="${values.map((v, c) => point(project(r, c, v))).join(" ")}" fill="none" stroke="#FF8A00" stroke-width="1.1"/>`,
    )
    .join("");
  const vertices =
    table.rows === 1 || table.columns === 1
      ? table.values
          .flatMap((values, r) =>
            values.map((v, c) => {
              const p = project(r, c, v);
              return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" fill="#FF8A00"><title>Linha ${r}, coluna ${c}: ${h(fmt(v))}</title></circle>`;
            }),
          )
          .join("")
      : "";
  const base = project(0, 0, table.min),
    colEnd = project(0, table.columns - 1, table.min),
    rowEnd = project(table.rows - 1, 0, table.min);
  return `<svg viewBox="0 0 720 350" role="img" aria-label="Superfície de valores brutos, eixos por índices de linhas e colunas" style="width:100%;height:auto"><path d="M${point(colEnd)}L${point(base)}L${point(rowEnd)}" stroke="#858585" fill="none"/>${mesh}${rows}${vertices}<text x="18" y="24" fill="#fff" font-size="13">Valores brutos: ${h(fmt(table.min))} a ${h(fmt(table.max))}</text><text x="18" y="326" fill="#bbb" font-size="12">Linhas 0–${table.rows - 1} · colunas 0–${table.columns - 1} · altura normalizada para visualização</text></svg>`;
}

export function createBinaryWorkbench({
  notify = () => {},
  download = () => {},
  onSafetyChange = () => {},
  canOperate = () => true,
} = {}) {
  let bytes = null,
    info = null,
    filename = "",
    busy = false,
    exported = false,
    host = null;
  let options = { ...DEFAULTS },
    table = null,
    selectedRow = 0,
    angle = 35,
    draft = false,
    draftOptions = null;
  let removeListeners = () => {},
    generation = 0;
  const safety = () => onSafetyChange();
  const allowed = () => {
    if (!canOperate()) {
      notify("Aguarde a atualização em preparação.");
      return false;
    }
    return true;
  };
  const error = (value) =>
    notify(value?.message || "Não foi possível ler o arquivo.", true);
  function markChanged(isDraft = false) {
    exported = false;
    draft = draft || isDraft;
    const status = host?.querySelector("[data-binary-export-state]");
    if (status)
      status.textContent = draft
        ? "Recorte editado. Aplique os parâmetros antes de exportar o relatório."
        : "Análise alterada em memória. Exporte o relatório ou feche o arquivo para liberar a atualização.";
    safety();
  }
  function formOptions(form) {
    return Object.fromEntries(
      Object.keys(DEFAULTS).map((key) => [
        key,
        form.querySelector(`[name="${key}"]`).value,
      ]),
    );
  }
  function preserveDraft(form) {
    draftOptions = formOptions(form);
    markChanged(true);
  }
  const controls = () => {
    const fields = draftOptions || options;
    return `<form id="binary-table-form" class="padded-form binary-controls"><div class="form-grid"><label>Endereço inicial (decimal ou 0x)<input name="offset" value="${h(fields.offset)}" required></label><label>Tipo de valor<select name="type">${Object.entries(
      BINARY_TYPES,
    )
      .map(
        ([key, value]) =>
          `<option value="${key}" ${key === fields.type ? "selected" : ""}>${h(value.label)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Ordem dos bytes<select name="endian"><option value="little" ${fields.endian === "little" ? "selected" : ""}>Little-endian</option><option value="big" ${fields.endian === "big" ? "selected" : ""}>Big-endian</option></select></label><label>Linhas<input name="rows" type="number" min="1" max="32" value="${h(fields.rows)}" required></label><label>Colunas<input name="columns" type="number" min="1" max="32" value="${h(fields.columns)}" required></label></div><button type="submit" class="btn primary" ${busy ? "disabled" : ""}>Ler recorte</button><p class="notice">Escolha endereços e formato conforme documentação. O recorte não identifica mapas, eixos físicos ou calibração.</p></form>`;
  };
  const results = () =>
    !table
      ? ""
      : `<section class="panel"><div class="panel-heading"><div><h2>Visualização do recorte</h2><p>${hex(table.offset)} até ${hex(table.end_offset_exclusive)} (fim exclusivo) · ${table.rows} × ${table.columns} · ${h(table.type)} · ${h(table.endian)}</p></div></div><div class="system-content"><label>Linha do gráfico 2D<select data-binary-row>${table.values.map((_, index) => `<option value="${index}" ${index === selectedRow ? "selected" : ""}>Linha ${index}</option>`).join("")}</select></label><div class="binary-chart" data-binary-line>${binaryLineSvg(table, selectedRow)}</div><label>Girar superfície 3D <input data-binary-angle type="range" min="-180" max="180" step="5" value="${angle}" aria-label="Ângulo da superfície 3D"></label><div class="binary-chart" data-binary-surface>${binarySurfaceSvg(table, angle)}</div><p class="notice">Os dois gráficos representam os mesmos bytes. Eixos por índice, sem unidade física atribuída. O arquivo permanece intacto.</p></div><div class="table-wrap"><table class="binary-grid"><caption>Valores brutos por linha e coluna</caption><thead><tr><th>Linha</th>${table.values[0].map((_, index) => `<th>${index}</th>`).join("")}</tr></thead><tbody>${table.values.map((values, index) => `<tr><th>${index}</th>${values.map((value) => `<td>${h(fmt(value))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
  function page() {
    return `<div class="binary-workbench"><div class="page-heading"><div><span class="eyebrow">ARQUIVO LOCAL · SOMENTE LEITURA</span><h1>Inspeção de BIN</h1><p>Confira bytes e recortes numéricos sem conectar ou modificar uma ECU.</p></div></div><section class="panel"><div class="panel-heading"><div><h2>${info ? "Arquivo carregado" : "Abrir arquivo binário"}</h2><p>Até 8 MiB. O arquivo fica na memória deste aplicativo e não é enviado.</p></div></div><div class="padded-form"><p data-binary-status class="notice" role="status"></p><label>Arquivo BIN<input type="file" data-binary-file accept=".bin,application/octet-stream" ${busy ? "disabled" : ""}></label>${info ? `<p><strong>${h(filename)}</strong> · ${fmt(info.byte_length)} bytes</p><p class="notice">SHA-256: <code style="overflow-wrap:anywhere">${info.sha256}</code><br>Entropia: ${fmt(info.entropy_bits_per_byte)} bits/byte · bytes 00: ${fmt(info.zero_fraction * 100)}% · FF: ${fmt(info.ff_fraction * 100)}%</p><div class="report-actions"><button type="button" class="btn" data-binary-export ${busy ? "disabled" : ""}>Exportar relatório JSON</button><button type="button" class="btn subtle" data-binary-discard ${busy ? "disabled" : ""}>Fechar arquivo</button></div><p class="notice" data-binary-export-state>${exported ? "Relatório preparado. Confira se foi salvo em Arquivos antes de fechar o aplicativo." : draft ? "Recorte editado. Aplique os parâmetros antes de exportar o relatório." : "Arquivo em memória. Exporte o relatório ou feche o arquivo para liberar a atualização do aplicativo."}</p>` : '<p class="notice">Sem arquivo carregado. Não há BINs ou curvas de demonstração nesta bancada.</p>'}</div></section>${info ? `<section class="panel"><div class="panel-heading"><div><h2>Recorte numérico</h2><p>Parâmetros de leitura explícitos, sem alterar valores.</p></div></div>${controls()}</section>${results()}<section class="panel"><div class="panel-heading"><div><h2>Prévia hexadecimal</h2><p>Até os primeiros 256 bytes do arquivo original.</p></div></div><div class="table-wrap"><table class="binary-hex"><thead><tr><th>Endereço</th><th>Bytes</th><th>ASCII</th></tr></thead><tbody>${info.hex_preview.map((row) => `<tr><th>${hex(row.offset)}</th><td><code>${row.hex}</code></td><td><code>${h(row.ascii)}</code></td></tr>`).join("")}</tbody></table></div></section>` : ""}<p class="notice">Inspeção genérica: não identifica a família da ECU, a função dos dados ou a validade de checksums. Gráficos não comprovam que o recorte é um mapa de calibração. Não há edição, correção de checksum ou gravação.</p></div>`;
  }
  function repaint() {
    if (host?.isConnected) {
      host.innerHTML = page();
      bind(host);
    }
    safety();
  }
  async function load(file) {
    if (busy || !allowed()) return;
    if (
      !file ||
      typeof file.arrayBuffer !== "function" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > MAX_BINARY_BYTES
    ) {
      error(new Error("Selecione um arquivo não vazio de até 8 MiB."));
      return;
    }
    if (
      bytes &&
      !exported &&
      !globalThis.confirm(
        "Substituir a análise em memória? Exporte o relatório antes se precisar guardá-la.",
      )
    )
      return;
    const loadGeneration = ++generation;
    busy = true;
    safety();
    const status = host?.querySelector("[data-binary-status]");
    if (status) status.textContent = "Lendo os bytes e calculando SHA-256…";
    for (const control of host?.querySelectorAll("button,input,select") || [])
      control.disabled = true;
    try {
      const buffer = await file.arrayBuffer();
      if (loadGeneration !== generation) return;
      const nextBytes = new Uint8Array(buffer).slice();
      const nextInfo = await inspectBinary(nextBytes);
      if (loadGeneration !== generation) return;
      bytes = nextBytes;
      info = nextInfo;
      filename = String(file.name || "arquivo.bin").slice(0, 255);
      exported = false;
      options = {
        ...DEFAULTS,
        rows: Math.min(8, Math.max(1, Math.floor(bytes.length / 8))),
        columns: Math.min(8, bytes.length),
      };
      table = readTable(bytes, options);
      selectedRow = 0;
      angle = 35;
      draft = false;
      draftOptions = null;
      notify(
        "Arquivo lido localmente. Defina o recorte conforme a documentação.",
      );
    } catch (value) {
      if (loadGeneration === generation) error(value);
    } finally {
      if (loadGeneration === generation) {
        busy = false;
        repaint();
      }
    }
  }
  function bind(element) {
    removeListeners();
    host = element;
    const onChange = (event) => {
      if (!host?.contains(event.target)) return;
      if (event.target.matches("[data-binary-file]")) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void load(file);
        return;
      }
      if (busy || !allowed()) return;
      if (event.target.matches("[data-binary-row]") && table) {
        selectedRow = Number(event.target.value);
        host.querySelector("[data-binary-line]").innerHTML = binaryLineSvg(
          table,
          selectedRow,
        );
        markChanged();
      }
      const form = event.target.closest("#binary-table-form");
      if (form) preserveDraft(form);
    };
    const onInput = (event) => {
      if (!host?.contains(event.target)) return;
      if (busy || !allowed()) return;
      if (event.target.matches("[data-binary-angle]") && table) {
        angle = Number(event.target.value);
        host.querySelector("[data-binary-surface]").innerHTML =
          binarySurfaceSvg(table, angle);
        markChanged();
      }
      const form = event.target.closest("#binary-table-form");
      if (form) preserveDraft(form);
    };
    const onSubmit = (event) => {
      if (
        event.target.id !== "binary-table-form" ||
        !host?.contains(event.target)
      )
        return;
      event.preventDefault();
      if (busy || !bytes || !allowed()) return;
      try {
        preserveDraft(event.target);
        const next = { ...draftOptions };
        const nextTable = readTable(bytes, next);
        options = next;
        table = nextTable;
        selectedRow = 0;
        exported = false;
        draft = false;
        draftOptions = null;
        repaint();
      } catch (value) {
        error(value);
      }
    };
    const onClick = (event) => {
      const button = event.target.closest("button");
      if (!button || !host?.contains(button) || busy || !allowed()) return;
      if (button.hasAttribute("data-binary-export") && info) {
        if (draft) {
          error(
            new Error(
              "Aplique o recorte editado antes de exportar o relatório.",
            ),
          );
          return;
        }
        try {
          download(
            JSON.stringify(
              {
                schema_version: 1,
                application: "AUTO ECU LAB",
                operation: "local_binary_read_only",
                generated_at: new Date().toISOString(),
                file: { name: filename, ...info },
                table: table ? structuredClone(table) : null,
                visualization: {
                  selected_row: selectedRow,
                  angle_degrees: angle,
                },
              },
              null,
              2,
            ),
            "auto_ecu_lab_inspecao_bin.json",
            "application/json",
          );
          exported = true;
          notify(
            "Relatório preparado. Confira o arquivo salvo no seu aparelho.",
          );
          repaint();
        } catch (value) {
          error(value);
        }
      }
      if (button.hasAttribute("data-binary-discard")) {
        if (
          !exported &&
          !globalThis.confirm(
            "Fechar o arquivo em memória? O arquivo original não será alterado. Exporte o relatório antes se precisar guardar a análise.",
          )
        )
          return;
        bytes = null;
        info = null;
        table = null;
        filename = "";
        exported = false;
        draft = false;
        draftOptions = null;
        options = { ...DEFAULTS };
        repaint();
      }
    };
    host.addEventListener("change", onChange);
    host.addEventListener("input", onInput);
    host.addEventListener("submit", onSubmit);
    host.addEventListener("click", onClick);
    removeListeners = () => {
      element.removeEventListener("change", onChange);
      element.removeEventListener("input", onInput);
      element.removeEventListener("submit", onSubmit);
      element.removeEventListener("click", onClick);
    };
  }
  return {
    page,
    bind,
    get isBusy() {
      return busy;
    },
    get hasUnsavedData() {
      return !!bytes && !exported;
    },
    async leave() {
      if (busy) {
        notify("Aguarde a leitura do arquivo.");
        return false;
      }
      return true;
    },
    dispose() {
      generation++;
      busy = false;
      removeListeners();
      host = null;
      bytes = null;
      info = null;
      table = null;
      draftOptions = null;
      safety();
    },
  };
}
