import test from "node:test";
import assert from "node:assert/strict";
import { renderSignalChart } from "../dist/chart.mjs";

// DOM mínimo para exercitar lógica de interação sem navegador ou dependências.
class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.className = "";
    this.classList = { add: (name) => { this.className += ` ${name}`; } };
    this.listeners = new Map();
    this.ownText = "";
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.ownText = ""; this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
  }
  removeEventListener(name, handler) { this.listeners.get(name)?.delete(handler); }
  emit(name, event = {}) { for (const callback of this.listeners.get(name) || []) callback(event); }
  getBoundingClientRect() { return { left: 0, width: 1000 }; }
}

globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (ns, tag) => new FakeElement(tag),
};
function all(node) { return [node, ...node.children.flatMap(all)]; }
function find(node, predicate) { return all(node).find(predicate); }
function bySuffix(node, suffix) { return find(node, (item) => item.id?.endsWith(suffix)); }
const samples = [
  { time_s: 0, pedal_pct: 0, throttle_pct: 5, rpm: 850 },
  { time_s: 1, pedal_pct: 35, throttle_pct: 12.345678, rpm: 1000 },
  { time_s: 2, pedal_pct: 60, throttle_pct: 40, rpm: 2200 },
];

test("gráfico mostra três sinais e consulta valores da amostra sem interpolar", () => {
  const container = new FakeElement("div");
  renderSignalChart(container, samples);
  assert.equal(all(container).filter((node) => node.tag === "path").length, 3);
  const selection = bySuffix(container, "-sample");
  selection.value = "2";
  selection.emit("input");
  const output = bySuffix(container, "-reading");
  assert.match(output.textContent, /Tempo: 1 s/);
  assert.match(output.textContent, /12,345678%/);
  assert.equal(output.getAttribute("aria-live"), "polite");
});

test("legenda oculta um sinal mantendo estado acessível", () => {
  const container = new FakeElement("div");
  renderSignalChart(container, samples);
  const rpm = find(container, (node) => node.tag === "button" && node.dataset.series === "rpm");
  rpm.emit("click");
  assert.equal(rpm.getAttribute("aria-pressed"), "false");
  assert.equal(all(container).filter((node) => node.tag === "path").length, 2);
  rpm.emit("click");
  assert.equal(rpm.getAttribute("aria-pressed"), "true");
});

test("zoom restringe consulta e botão restaura a janela completa", () => {
  const container = new FakeElement("div");
  renderSignalChart(container, samples);
  const start = bySuffix(container, "-start");
  const selection = bySuffix(container, "-sample");
  start.value = "60";
  start.emit("input");
  assert.equal(selection.min, "3");
  assert.equal(selection.value, "3");
  const reset = find(container, (node) => node.tag === "button" && node.textContent.startsWith("Restaurar"));
  reset.emit("click");
  assert.equal(start.value, "0");
  assert.equal(selection.min, "1");
  assert.equal(selection.max, "3");
});

test("toque no SVG seleciona a amostra real mais próxima", () => {
  const container = new FakeElement("div");
  renderSignalChart(container, samples);
  const svg = find(container, (node) => node.tag === "svg");
  svg.emit("pointerdown", { clientX: 498.5 });
  assert.equal(bySuffix(container, "-sample").value, "2");
  assert.match(bySuffix(container, "-reading").textContent, /RPM medido: 1000/);
});

test("simulação pode ser atualizada e rejeita timestamps incompatíveis", () => {
  const container = new FakeElement("div");
  const chart = renderSignalChart(container, samples, { simulationMode: true });
  assert.equal(all(container).filter((node) => node.tag === "path").length, 2);
  const values = samples.map((sample) => ({ time_s: sample.time_s, simulated_throttle_pct: sample.pedal_pct * 0.8 }));
  chart.updateSimulation(values);
  assert.equal(all(container).filter((node) => node.tag === "path").length, 3);
  assert.match(bySuffix(container, "-reading").textContent, /Borboleta simulada/);
  assert.throws(() => chart.updateSimulation([{ time_s: 10, simulated_throttle_pct: 50 }]), /cada instante/);
});

test("registros longos têm representação limitada mantendo consulta completa", () => {
  const container = new FakeElement("div");
  const large = Array.from({ length: 50000 }, (_, i) => ({ time_s: i / 100, pedal_pct: i % 100, throttle_pct: (i % 100) / 2, rpm: 800 + (i % 1200) }));
  renderSignalChart(container, large);
  for (const path of all(container).filter((node) => node.tag === "path")) {
    assert.ok(path.getAttribute("d").match(/[ML]/g).length <= 1802);
  }
  const selection = bySuffix(container, "-sample");
  assert.equal(selection.max, "50000");
  selection.value = "50000";
  selection.emit("input");
  assert.match(bySuffix(container, "-reading").textContent, /Tempo: 499,99 s/);
});

test("destroy limpa os eventos e o conteúdo do gráfico", () => {
  const container = new FakeElement("div");
  const chart = renderSignalChart(container, samples);
  const svg = find(container, (node) => node.tag === "svg");
  chart.destroy();
  assert.equal(container.children.length, 0);
  assert.equal(svg.listeners.get("pointerdown").size, 0);
  chart.updateSimulation(null);
  assert.equal(container.children.length, 0);
});
