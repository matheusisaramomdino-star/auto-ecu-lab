// Catálogo de cadastro; nenhum preset confirma a ECU ou a cobertura do scanner.
const presetSelector=document.getElementById('vehicle-preset');
if(presetSelector){presetSelector.addEventListener('change',()=>{const item=JSON.parse(document.getElementById('vehicle-catalog').textContent).find(v=>v.key===presetSelector.value);if(!item)return;for(const key of ['brand','model','year','engine'])presetSelector.form.elements[key].value=item[key]??'';for(const key of ['manufacturer','identification','hardware','software'])presetSelector.form.elements[key].value='';presetSelector.form.elements.ecu_source.value='Não confirmada';});}
/* Interface e gráficos locais: nenhuma biblioteca ou requisição externa. */
"use strict";
document
  .querySelectorAll("[data-auto-submit]")
  .forEach((el) =>
    el.addEventListener("change", () => el.form.requestSubmit()),
  );
const chartData = document.getElementById("chart-data");
if (chartData) initializeLab(JSON.parse(chartData.textContent));

function initializeLab(data) {
  const samples = data.samples;
  const svg = document.getElementById("signal-chart");
  const startInput = document.getElementById("zoom-start");
  const endInput = document.getElementById("zoom-end");
  const tooltip = document.getElementById("chart-tooltip");
  const ns = "http://www.w3.org/2000/svg";
  const colors = {
    pedal_pct: "#ff8a00",
    throttle_pct: "#c79b42",
    rpm: "#928abe",
    simulated_throttle_pct: "#488ebc",
  };
  const labels = {
    pedal_pct: "Pedal",
    throttle_pct: "Borboleta medida",
    rpm: "RPM",
    simulated_throttle_pct: "Borboleta simulada",
  };
  const visible = new Set(
    [...document.querySelectorAll("[data-series]")].map(
      (b) => b.dataset.series,
    ),
  );
  const format = (n, digits = 2) =>
    n.toLocaleString("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const first = samples[0].time_s,
    last = samples[samples.length - 1].time_s;
  const maxRpm = Math.max(
    1000,
    Math.ceil(samples.reduce((m, s) => Math.max(m, s.rpm), 0) / 1000) * 1000,
  );
  let simulationValues = null;
  let xMin, xMax, xScale;
  let hoverLine;
  function node(tag, attrs, text) {
    const element = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) =>
      element.setAttribute(key, value),
    );
    if (text !== undefined) element.textContent = text;
    svg.appendChild(element);
    return element;
  }
  function draw() {
    svg.replaceChildren();
    node("title", {}, "Pedal, borboleta e rotação ao longo do tempo");
    xMin = first + ((last - first) * Number(startInput.value)) / 100;
    xMax = first + ((last - first) * Number(endInput.value)) / 100;
    xScale = (t) => 55 + ((t - xMin) / (xMax - xMin)) * 888;
    const y = (percent) => 270 - percent * 2.2;
    for (let tick = 0; tick <= 100; tick += 20) {
      node("line", {
        x1: 55,
        x2: 943,
        y1: y(tick),
        y2: y(tick),
        class: "grid",
      });
      node(
        "text",
        { x: 43, y: y(tick) + 3, "text-anchor": "end" },
        String(tick),
      );
      if (visible.has("rpm"))
        node("text", { x: 954, y: y(tick) + 3 }, String((maxRpm * tick) / 100));
    }
    node("text", { x: 28, y: 25 }, "%");
    if (visible.has("rpm")) node("text", { x: 950, y: 25 }, "RPM");
    for (let tick = 0; tick <= 7; tick++) {
      const t = xMin + ((xMax - xMin) * tick) / 7;
      node(
        "text",
        { x: xScale(t), y: 294, "text-anchor": "middle" },
        format(t, 1),
      );
    }
    node("text", { x: 500, y: 317, "text-anchor": "middle" }, "Tempo (s)");
    (data.events || []).forEach((e, index) => {
      if (e.time_s > xMax || e.end_s < xMin) return;
      const left = xScale(Math.max(xMin, e.time_s)),
        right = xScale(Math.min(xMax, e.end_s));
      node("rect", {
        x: left,
        y: 43,
        width: Math.max(0, right - left),
        height: 227,
        fill: "#3b8872",
        opacity: ".035",
      });
      if (e.time_s >= xMin) {
        node("line", {
          x1: left,
          x2: left,
          y1: 45,
          y2: 270,
          stroke: "#b9d4c9",
          "stroke-dasharray": "3 5",
        });
        node("text", { x: left + 6, y: 38 }, `E${index + 1}`);
      }
    });
    // Segmentos adjacentes à janela são mantidos para evitar cortar uma curva no zoom.
    let lo = lowerBound(xMin),
      hi = lowerBound(xMax);
    lo = Math.max(0, lo - 1);
    hi = Math.min(samples.length - 1, hi + 1);
    const defs = node("defs", {});
    const clip = document.createElementNS(ns, "clipPath");
    clip.id = "plot-clip";
    const rect = document.createElementNS(ns, "rect");
    Object.entries({ x: 55, y: 43, width: 888, height: 227 }).forEach(
      ([k, v]) => rect.setAttribute(k, v),
    );
    clip.appendChild(rect);
    defs.appendChild(clip);
    visible.forEach((key) => {
      if (key === "simulated_throttle_pct" && !simulationValues) return;
      let d = "";
      for (let i = lo; i <= hi; i++) {
        const value =
          key === "simulated_throttle_pct"
            ? simulationValues[i].simulated_throttle_pct
            : samples[i][key];
        const scaled = key === "rpm" ? (value / maxRpm) * 100 : value;
        d += `${i === lo ? "M" : "L"}${xScale(samples[i].time_s).toFixed(2)},${y(scaled).toFixed(2)} `;
      }
      node("path", {
        d,
        stroke: colors[key],
        class: "series-line",
        "clip-path": "url(#plot-clip)",
      });
    });
    hoverLine = node("line", {
      x1: 0,
      x2: 0,
      y1: 43,
      y2: 270,
      stroke: "#a2afb7",
      "stroke-dasharray": "3 3",
      visibility: "hidden",
    });
    document.getElementById("chart-window").textContent =
      `${format(xMin, 1)}–${format(xMax, 1)} s`;
    tooltip.hidden = true;
  }
  function lowerBound(time) {
    let lo = 0,
      hi = samples.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (samples[mid].time_s < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  svg.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect(),
      x = ((event.clientX - rect.left) / rect.width) * 1000;
    if (x < 55 || x > 943) {
      tooltip.hidden = true;
      hoverLine.setAttribute("visibility", "hidden");
      return;
    }
    const time = xMin + ((x - 55) / 888) * (xMax - xMin);
    let i = Math.min(samples.length - 1, lowerBound(time));
    if (
      i > 0 &&
      Math.abs(samples[i - 1].time_s - time) <
        Math.abs(samples[i].time_s - time)
    )
      i--;
    const s = samples[i],
      location = xScale(s.time_s);
    hoverLine.setAttribute("x1", location);
    hoverLine.setAttribute("x2", location);
    hoverLine.setAttribute("visibility", "visible");
    let lines = [`Tempo: ${format(s.time_s)} s`];
    visible.forEach((key) => {
      if (key === "simulated_throttle_pct" && !simulationValues) return;
      const v =
        key === "simulated_throttle_pct"
          ? simulationValues[i].simulated_throttle_pct
          : s[key];
      lines.push(
        `${labels[key]}: ${format(v, key === "rpm" ? 0 : 1)} ${key === "rpm" ? "RPM" : "%"}`,
      );
    });
    tooltip.textContent = lines.join("\n");
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(0, Math.min(event.clientX - rect.left + 20, rect.width - 220))}px`;
    tooltip.style.top = "40px";
  });
  svg.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    hoverLine.setAttribute("visibility", "hidden");
  });
  startInput.addEventListener("input", () => {
    if (+startInput.value >= +endInput.value)
      endInput.value = +startInput.value + 1;
    draw();
  });
  endInput.addEventListener("input", () => {
    if (+endInput.value <= +startInput.value)
      startInput.value = +endInput.value - 1;
    draw();
  });
  document.querySelector("[data-reset-chart]").addEventListener("click", () => {
    startInput.value = 0;
    endInput.value = 100;
    draw();
  });
  document.querySelectorAll("[data-series]").forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.series;
      if (visible.has(key)) visible.delete(key);
      else visible.add(key);
      button.setAttribute("aria-pressed", visible.has(key));
      draw();
    }),
  );
  draw();

  const form = document.getElementById("simulation-form");
  if (!form) return;
  const status = document.getElementById("simulation-status");
  const inputs = [...form.querySelectorAll("input[type=range]")];
  const preset = document.getElementById("simulation-preset");
  function outputs() {
    inputs.forEach(
      (input) =>
        (form.querySelector(`output[for="${input.id}"]`).textContent = format(
          +input.value,
          2,
        )),
    );
  }
  inputs.forEach((input) =>
    input.addEventListener("input", () => {
      outputs();
      preset.value = "custom";
      status.textContent =
        "Parâmetros alterados. Clique em comparar para atualizar a curva.";
    }),
  );
  preset.addEventListener("change", () => {
    const presets = {
      suave: [0.35, 0.6, 1.6, 85],
      linear: [0.15, 0.25, 1, 85],
      rapido: [0.05, 0.1, 0.7, 85],
    };
    if (presets[preset.value])
      inputs.forEach((input, i) => (input.value = presets[preset.value][i]));
    outputs();
    run(false);
  });
  let busy = false;
  async function run(download) {
    if (busy) return;
    busy = true;
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    status.textContent = "Calculando o modelo…";
    const params = Object.fromEntries(
      inputs.map((input) => [input.name, +input.value]),
    );
    params.download = download;
    try {
      const response = await fetch(form.dataset.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": form.elements.csrf_token.value,
        },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Não foi possível calcular.");
      }
      if (download) {
        const blob = await response.blob(),
          link = document.createElement("a"),
          url = URL.createObjectURL(blob);
        link.href = url;
        link.download = "auto_ecu_lab_simulacao.csv";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent =
          "CSV gerado com dados medidos e simulados em colunas separadas.";
      } else {
        const result = await response.json();
        simulationValues = result.values;
        draw();
        status.textContent =
          "Curva atualizada. Simulação didática, sem previsão de torque ou RPM.";
      }
    } catch (error) {
      status.textContent = error.message || "Falha ao calcular a simulação.";
    } finally {
      busy = false;
      form.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(false);
  });
  document
    .getElementById("download-simulation")
    .addEventListener("click", () => run(true));
  outputs();
  run(false);
}
