/* Gráficos SVG locais, com consulta acessível por toque e teclado. */
let chartSequence = 0;

const NS = "http://www.w3.org/2000/svg";
const COLORS = {
  pedal_pct: "#ff8a00",
  throttle_pct: "#ffffff",
  rpm: "#bcbcbc",
  simulated_throttle_pct: "#ffbd70",
};
const LABELS = {
  pedal_pct: "Pedal",
  throttle_pct: "Borboleta medida",
  rpm: "RPM medido",
  simulated_throttle_pct: "Borboleta simulada",
};
const format = (value, digits = 1) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const exact = (value) => String(value).replace(".", ",");

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function lowerBound(samples, time) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].time_s < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function renderSignalChart(
  container,
  samples,
  { events = [], simulation = null, simulationMode = false } = {},
) {
  container.replaceChildren();
  if (!Array.isArray(samples) || samples.length < 2) {
    container.append(
      element(
        "p",
        "panel-footnote",
        "Sem amostras suficientes para criar o gráfico.",
      ),
    );
    return {
      updateSimulation() {},
      destroy() {
        container.replaceChildren();
      },
    };
  }

  const id = `ecu-chart-${++chartSequence}`;
  const cleanup = [];
  let destroyed = false;
  let simulated = simulation;
  let cursor;
  let selected = 0;
  let plotMin;
  let plotMax;
  let xScale;
  const first = samples[0].time_s;
  const last = samples[samples.length - 1].time_s;
  const duration = last - first;
  if (!(duration > 0)) {
    throw new Error("O gráfico exige tempo crescente entre as amostras.");
  }
  const maximumRpm = Math.max(
    1000,
    Math.ceil(
      samples.reduce((maximum, s) => Math.max(maximum, s.rpm), 0) / 1000,
    ) * 1000,
  );
  const keys = simulationMode
    ? ["pedal_pct", "throttle_pct", "simulated_throttle_pct"]
    : ["pedal_pct", "throttle_pct", "rpm"];
  const visible = new Set(keys);

  function on(target, name, handler) {
    target.addEventListener(name, handler);
    cleanup.push(() => target.removeEventListener(name, handler));
  }
  function button(text, className = "btn compact subtle") {
    const el = element("button", className, text);
    el.type = "button";
    return el;
  }
  function range(labelText, suffix, min, max, value, step = 1) {
    const label = element("label", "", labelText);
    const input = element("input");
    input.type = "range";
    input.id = `${id}-${suffix}`;
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.step = String(step);
    label.htmlFor = input.id;
    label.append(input);
    return { label, input };
  }

  const toolbar = element("div", "chart-toolbar");
  const legend = element("div", "legend");
  legend.setAttribute("aria-label", "Sinais visíveis no gráfico");
  for (const key of keys) {
    const toggle = button(LABELS[key], "");
    toggle.dataset.series = key;
    toggle.setAttribute("aria-pressed", "true");
    const swatch = element("i");
    swatch.style.backgroundColor = COLORS[key];
    swatch.setAttribute("aria-hidden", "true");
    toggle.prepend(swatch);
    on(toggle, "click", () => {
      if (visible.has(key)) visible.delete(key);
      else visible.add(key);
      toggle.setAttribute("aria-pressed", String(visible.has(key)));
      draw();
    });
    legend.append(toggle);
  }
  const reset = button("Restaurar zoom ↺");
  toolbar.append(legend, reset);

  const wrapper = element("div", "chart-wrap");
  const svg = document.createElementNS(NS, "svg");
  svg.classList.add("signal-chart");
  svg.setAttribute("viewBox", "0 0 1000 330");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Sinais ao longo do tempo. Para consultar valores exatos, use o controle Consultar amostra abaixo do gráfico.",
  );
  svg.style.touchAction = "pan-y";
  wrapper.append(svg);

  const zoom = element("div", "zoom");
  const start = range("Início", "start", 0, 99.9, 0, 0.1);
  const end = range("Fim", "end", 0.1, 100, 100, 0.1);
  start.input.setAttribute(
    "aria-label",
    "Início do zoom, em porcentagem do tempo total",
  );
  end.input.setAttribute(
    "aria-label",
    "Fim do zoom, em porcentagem do tempo total",
  );
  const windowOutput = element("output");
  windowOutput.setAttribute("for", `${start.input.id} ${end.input.id}`);
  zoom.append(start.label, windowOutput, end.label);

  const inspector = element("div", "sample-inspector");
  const selection = range("Consultar amostra", "sample", 1, samples.length, 1);
  const reading = element("output");
  reading.id = `${id}-reading`;
  reading.setAttribute("for", selection.input.id);
  reading.setAttribute("aria-live", "polite");
  reading.setAttribute("aria-atomic", "true");
  selection.input.setAttribute("aria-describedby", reading.id);
  inspector.append(selection.label, reading);

  const note = element("p", "chart-note");
  container.append(toolbar, wrapper, zoom, inspector, note);

  function svgNode(tag, attrs = {}, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  }
  function valueAt(key, index) {
    return key === "simulated_throttle_pct"
      ? simulated[index].simulated_throttle_pct
      : samples[index][key];
  }

  function selectedIndexes(key, low, high) {
    const budget = 1800;
    const count = high - low + 1;
    if (count <= budget) {
      return Array.from({ length: count }, (_, i) => low + i);
    }
    // Cada faixa mantém seus extremos para não esconder picos em registros longos.
    const points = new Set([low, high]);
    const buckets = Math.floor(budget / 2);
    for (let bucket = 0; bucket < buckets; bucket++) {
      const begin = low + Math.floor((bucket * count) / buckets);
      const limit = Math.min(
        high + 1,
        low + Math.floor(((bucket + 1) * count) / buckets),
      );
      let minimum = begin;
      let maximum = begin;
      for (let index = begin + 1; index < limit; index++) {
        if (valueAt(key, index) < valueAt(key, minimum)) minimum = index;
        if (valueAt(key, index) > valueAt(key, maximum)) maximum = index;
      }
      points.add(minimum);
      points.add(maximum);
    }
    return [...points].sort((a, b) => a - b);
  }

  function updateReading() {
    selected = Math.max(0, Math.min(samples.length - 1, selected));
    selection.input.value = String(selected + 1);
    const sample = samples[selected];
    const parts = [
      `Amostra ${selected + 1}/${samples.length}`,
      `Tempo: ${exact(sample.time_s)} s`,
      `Pedal: ${exact(sample.pedal_pct)}%`,
      `Borboleta medida: ${exact(sample.throttle_pct)}%`,
      `RPM medido: ${exact(sample.rpm)}`,
    ];
    if (simulationMode && simulated) {
      parts.push(
        `Borboleta simulada: ${exact(simulated[selected].simulated_throttle_pct)}%`,
      );
    }
    reading.textContent = parts.join(" · ");
    selection.input.setAttribute(
      "aria-valuetext",
      `Amostra ${selected + 1}, tempo ${exact(sample.time_s)} segundos`,
    );
    if (cursor && sample.time_s >= plotMin && sample.time_s <= plotMax) {
      cursor.setAttribute("x1", xScale(sample.time_s));
      cursor.setAttribute("x2", xScale(sample.time_s));
      cursor.setAttribute("visibility", "visible");
    } else if (cursor) cursor.setAttribute("visibility", "hidden");
  }

  function draw() {
    if (destroyed) return;
    svg.replaceChildren();
    svgNode(
      "title",
      {},
      simulationMode
        ? "Pedal e comparação da borboleta medida com a simulada"
        : "Pedal, borboleta e rotação ao longo do tempo",
    );
    plotMin = first + (duration * Number(start.input.value)) / 100;
    plotMax = first + (duration * Number(end.input.value)) / 100;
    xScale = (time) => 57 + ((time - plotMin) / (plotMax - plotMin)) * 883;
    const yScale = (percentage) => 278 - percentage * 2.25;
    for (let tick = 0; tick <= 100; tick += 20) {
      svgNode("line", {
        x1: 57,
        x2: 940,
        y1: yScale(tick),
        y2: yScale(tick),
        class: "grid",
      });
      svgNode(
        "text",
        { x: 44, y: yScale(tick) + 4, "text-anchor": "end" },
        tick,
      );
      if (!simulationMode && visible.has("rpm")) {
        svgNode(
          "text",
          { x: 952, y: yScale(tick) + 4 },
          (maximumRpm * tick) / 100,
        );
      }
    }
    svgNode("text", { x: 35, y: 27 }, "%");
    if (!simulationMode && visible.has("rpm"))
      svgNode("text", { x: 949, y: 27 }, "RPM");
    for (let index = 0; index <= 7; index++) {
      const time = plotMin + ((plotMax - plotMin) * index) / 7;
      svgNode(
        "text",
        { x: xScale(time), y: 301, "text-anchor": "middle" },
        format(time, plotMax - plotMin < 1 ? 2 : 1),
      );
    }
    svgNode("text", { x: 500, y: 325, "text-anchor": "middle" }, "Tempo (s)");

    const inView = events
      .map((event, index) => ({ ...event, number: index + 1 }))
      .filter((event) => event.time_s <= plotMax && event.end_s >= plotMin);
    const stride = Math.max(1, Math.ceil(inView.length / 120));
    for (let index = 0; index < inView.length; index += stride) {
      const event = inView[index];
      const left = xScale(Math.max(plotMin, event.time_s));
      const right = xScale(Math.min(plotMax, event.end_s));
      svgNode("rect", {
        x: left,
        y: 47,
        width: Math.max(0, right - left),
        height: 231,
        fill: "#39856d",
        opacity: 0.04,
      });
      if (event.time_s >= plotMin) {
        svgNode("line", {
          x1: left,
          x2: left,
          y1: 47,
          y2: 278,
          stroke: "#b4cfc3",
          "stroke-dasharray": "3 5",
        });
        if (inView.length < 25)
          svgNode("text", { x: left + 5, y: 39 }, `E${event.number}`);
      }
    }

    let low = Math.max(0, lowerBound(samples, plotMin) - 1);
    let high = Math.min(samples.length - 1, lowerBound(samples, plotMax) + 1);
    const definitions = svgNode("defs");
    const clip = document.createElementNS(NS, "clipPath");
    clip.id = `${id}-clip`;
    const clipRect = document.createElementNS(NS, "rect");
    for (const [key, value] of Object.entries({
      x: 57,
      y: 47,
      width: 883,
      height: 231,
    }))
      clipRect.setAttribute(key, value);
    clip.append(clipRect);
    definitions.append(clip);
    for (const key of visible) {
      if (key === "simulated_throttle_pct" && !simulated) continue;
      const points = selectedIndexes(key, low, high);
      const path = points
        .map((index, position) => {
          const value = valueAt(key, index);
          const percentage = key === "rpm" ? (value / maximumRpm) * 100 : value;
          return `${position === 0 ? "M" : "L"}${xScale(samples[index].time_s).toFixed(2)},${yScale(percentage).toFixed(2)}`;
        })
        .join(" ");
      svgNode("path", {
        d: path,
        stroke: COLORS[key],
        "data-series": key,
        "clip-path": `url(#${id}-clip)`,
      });
    }
    cursor = svgNode("line", {
      x1: 0,
      x2: 0,
      y1: 47,
      y2: 278,
      stroke: "#a4b5bd",
      "stroke-dasharray": "3 3",
      visibility: "hidden",
    });
    windowOutput.textContent = `${format(plotMin, 2)}–${format(plotMax, 2)} s`;
    let firstInside = Math.min(
      samples.length - 1,
      lowerBound(samples, plotMin),
    );
    let lastInside = Math.min(samples.length - 1, lowerBound(samples, plotMax));
    if (samples[lastInside].time_s > plotMax && lastInside > firstInside)
      lastInside--;
    lastInside = Math.max(firstInside, lastInside);
    selection.input.min = String(firstInside + 1);
    selection.input.max = String(lastInside + 1);
    selected = Math.max(firstInside, Math.min(lastInside, selected));
    const reduced = high - low + 1 > 1800 || stride > 1;
    note.textContent = simulationMode
      ? "Curva simulada é um modelo didático. Consulte dados medidos e simulados pelo controle de amostra."
      : "Faixas claras indicam janelas dos acionamentos. Toque no gráfico ou use o controle para consultar a amostra.";
    if (reduced)
      note.textContent +=
        " Visualização reduzida por faixas, preservando extremos; a análise e a consulta usam todas as amostras.";
    if (samples[firstInside].time_s > plotMax)
      note.textContent +=
        " Não há amostras dentro deste zoom; a consulta mostra a próxima amostra disponível.";
    updateReading();
  }

  function pickFromPointer(event) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * 1000;
    if (viewX < 57 || viewX > 940) return;
    const time = plotMin + ((viewX - 57) / 883) * (plotMax - plotMin);
    let nearest = Math.min(samples.length - 1, lowerBound(samples, time));
    if (
      nearest > 0 &&
      Math.abs(samples[nearest - 1].time_s - time) <
        Math.abs(samples[nearest].time_s - time)
    )
      nearest--;
    selected = Math.max(
      Number(selection.input.min) - 1,
      Math.min(Number(selection.input.max) - 1, nearest),
    );
    updateReading();
  }
  on(svg, "pointerdown", pickFromPointer);
  on(svg, "pointermove", pickFromPointer);
  on(selection.input, "input", () => {
    selected = Number(selection.input.value) - 1;
    updateReading();
  });
  on(start.input, "input", () => {
    if (Number(start.input.value) >= Number(end.input.value))
      end.input.value = String(Math.min(100, Number(start.input.value) + 0.1));
    draw();
  });
  on(end.input, "input", () => {
    if (Number(end.input.value) <= Number(start.input.value))
      start.input.value = String(Math.max(0, Number(end.input.value) - 0.1));
    draw();
  });
  on(reset, "click", () => {
    start.input.value = "0";
    end.input.value = "100";
    draw();
  });

  function validateSimulation(values) {
    if (
      values !== null &&
      (!Array.isArray(values) ||
        values.length !== samples.length ||
        values.some(
          (value, index) =>
            !Number.isFinite(value?.simulated_throttle_pct) ||
            value.time_s !== samples[index].time_s,
        ))
    ) {
      throw new Error(
        "A simulação deve conter uma abertura finita para cada instante do ensaio.",
      );
    }
  }
  validateSimulation(simulated);
  draw();
  return {
    updateSimulation(values) {
      if (destroyed) return;
      validateSimulation(values);
      simulated = values;
      draw();
    },
    destroy() {
      destroyed = true;
      cleanup.forEach((remove) => remove());
      container.replaceChildren();
    },
  };
}
