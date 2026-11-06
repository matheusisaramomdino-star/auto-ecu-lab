import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  binaryLineSvg,
  binarySurfaceSvg,
  createBinaryWorkbench,
} from "../dist/binary-workbench.mjs";
import { readTable } from "../dist/binary.mjs";

test("gráficos usam o recorte, índices e valores reais, com rotação finita", () => {
  const table = readTable(new Uint8Array([0, 4, 8, 12]), {
    rows: 2,
    columns: 2,
  });
  const line = binaryLineSvg(table, 1);
  assert.match(line, /Coluna 0: 8/);
  assert.match(line, /Coluna 1: 12/);
  const surface = binarySurfaceSvg(table, 35);
  assert.match(surface, /<polygon/);
  assert.match(surface, /índices de linhas e colunas/);
  assert.notEqual(surface, binarySurfaceSvg(table, 90));
  assert.doesNotMatch(surface, /NaN|Infinity/);
  assert.throws(() => binaryLineSvg(table, 2), /Linha/);
  assert.throws(() => binarySurfaceSvg(table, Infinity), /Ângulo/);
});

test("bancada abre arquivo local, recorta, exporta, preserva original e adia atualização", async () => {
  const { document, Event } = parseHTML(
    "<html><body><main></main></body></html>",
  ).window;
  const host = document.querySelector("main");
  // O app pode manter listeners de outros módulos neste mesmo elemento.
  // Rebinding durante dispatch não deve processar de novo o alvo removido.
  host.addEventListener("click", () => {});
  host.addEventListener("submit", () => {});
  const source = new Uint8Array(Array.from({ length: 16 }, (_, i) => i));
  const downloads = [],
    notices = [];
  let safetyChanges = 0,
    operate = true;
  const previousConfirm = Object.getOwnPropertyDescriptor(
    globalThis,
    "confirm",
  );
  Object.defineProperty(globalThis, "confirm", {
    value: () => true,
    configurable: true,
  });
  const controller = createBinaryWorkbench({
    notify: (...x) => notices.push(x),
    download: (...x) => downloads.push(x),
    onSafetyChange: () => safetyChanges++,
    canOperate: () => operate,
  });
  const paint = () => {
    host.innerHTML = controller.page();
    controller.bind(host);
  };
  const until = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(JSON.stringify(notices));
  };
  const click = (selector) => host.querySelector(selector).click();
  const load = async (file) => {
    const input = host.querySelector("[data-binary-file]");
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => !controller.isBusy);
  };
  const file = {
    name: "<img src=x onerror=alert(1)>.bin",
    size: source.length,
    arrayBuffer: async () => source.buffer,
  };
  try {
    paint();
    assert.equal(controller.hasUnsavedData, false);
    assert.match(host.textContent, /Sem arquivo carregado/);
    await load(file);
    assert.equal(controller.hasUnsavedData, true);
    assert.equal(host.querySelectorAll("img").length, 0);
    assert.match(host.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.equal(host.querySelectorAll(".binary-grid tbody tr").length, 2);
    assert.equal(await controller.leave(), true);
    assert.equal(controller.hasUnsavedData, true);
    paint(); // Trocar tela não apaga a análise em memória.
    assert.match(host.textContent, /16 bytes/);
    const form = host.querySelector("#binary-table-form");
    form.querySelector("[name=offset]").value = "0x8";
    form.querySelector("[name=rows]").value = "1";
    form.querySelector("[name=columns]").value = "4";
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    assert.equal(host.querySelectorAll(".binary-grid tbody td").length, 4);
    click("[data-binary-export]");
    assert.equal(downloads.length, 1);
    const exported = JSON.parse(downloads[0][0]);
    assert.deepEqual(exported.table.values, [[8, 9, 10, 11]]);
    assert.equal(exported.operation, "local_binary_read_only");
    assert.equal(exported.file.byte_length, 16);
    assert.equal(controller.hasUnsavedData, false);
    assert.deepEqual(
      source,
      new Uint8Array(Array.from({ length: 16 }, (_, i) => i)),
    );
    const edited = host.querySelector("#binary-table-form [name=offset]");
    edited.value = "0x9";
    edited.dispatchEvent(new Event("input", { bubbles: true }));
    assert.equal(controller.hasUnsavedData, true);
    click("[data-binary-export]");
    assert.equal(downloads.length, 1);
    assert.match(notices.at(-1)[0], /Aplique o recorte/);
    host
      .querySelector("#binary-table-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    click("[data-binary-export]");
    assert.deepEqual(JSON.parse(downloads[1][0]).table.values, [
      [9, 10, 11, 12],
    ]);
    const rotation = host.querySelector("[data-binary-angle]");
    rotation.value = "90";
    rotation.dispatchEvent(new Event("input", { bubbles: true }));
    assert.equal(controller.hasUnsavedData, true);
    click("[data-binary-export]");
    assert.equal(JSON.parse(downloads[2][0]).visualization.angle_degrees, 90);
    operate = false;
    click("[data-binary-discard]");
    assert.match(host.textContent, /16 bytes/);
    operate = true;
    click("[data-binary-discard]");
    assert.match(host.textContent, /Sem arquivo carregado/);
    assert.equal(controller.hasUnsavedData, false);
    assert.ok(safetyChanges >= 4);
  } finally {
    controller.dispose();
    if (previousConfirm)
      Object.defineProperty(globalThis, "confirm", previousConfirm);
    else delete globalThis.confirm;
  }
});

test("erro de arquivo ou recorte preserva a última análise e troca pendente pede confirmação", async () => {
  const { document, Event } = parseHTML("<main></main>").window;
  const host = document.querySelector("main");
  const notices = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "confirm");
  let confirms = 0;
  Object.defineProperty(globalThis, "confirm", {
    value: () => {
      confirms++;
      return false;
    },
    configurable: true,
  });
  const controller = createBinaryWorkbench({
    notify: (...x) => notices.push(x),
  });
  const load = async (name, bytes) => {
    const input = host.querySelector("[data-binary-file]");
    Object.defineProperty(input, "files", {
      value: [
        { name, size: bytes.length, arrayBuffer: async () => bytes.buffer },
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 100 && controller.isBusy; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
  };
  try {
    host.innerHTML = controller.page();
    controller.bind(host);
    await load("primeiro.bin", new Uint8Array([5]));
    const form = host.querySelector("#binary-table-form");
    form.querySelector("[name=offset]").value = "99";
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    assert.match(notices.at(-1)[0], /fim do arquivo/);
    assert.match(host.textContent, /primeiro.bin/);
    await load("outro.bin", new Uint8Array([42]));
    assert.equal(confirms, 1);
    assert.match(host.textContent, /primeiro.bin/);
    assert.doesNotMatch(host.textContent, /outro.bin/);
    assert.equal(controller.hasUnsavedData, true);
  } finally {
    controller.dispose();
    if (previous) Object.defineProperty(globalThis, "confirm", previous);
    else delete globalThis.confirm;
  }
});

test("leitura em andamento bloqueia saída e descarte encerra a operação sem ressuscitar arquivo", async () => {
  const { document, Event } = parseHTML("<main></main>").window;
  const host = document.querySelector("main");
  const controller = createBinaryWorkbench();
  host.innerHTML = controller.page();
  controller.bind(host);
  let release;
  const input = host.querySelector("[data-binary-file]");
  Object.defineProperty(input, "files", {
    value: [
      {
        name: "pendente.bin",
        size: 1,
        arrayBuffer: () => new Promise((resolve) => (release = resolve)),
      },
    ],
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(controller.isBusy, true);
  assert.equal(await controller.leave(), false);
  assert.match(
    host.querySelector("[data-binary-status]").textContent,
    /SHA-256/,
  );
  controller.dispose();
  release(new Uint8Array([1]).buffer);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.isBusy, false);
  assert.equal(controller.hasUnsavedData, false);
  assert.doesNotMatch(controller.page(), /pendente\.bin/);
});

test("rascunho completo do recorte permanece ao sair e voltar sem aplicar", async () => {
  const { document, Event } = parseHTML("<main></main>").window;
  const host = document.querySelector("main");
  const original = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
  const snapshots = [],
    notices = [];
  const controller = createBinaryWorkbench({
    download: (content) => snapshots.push(JSON.parse(content)),
    notify: (message) => notices.push(message),
  });
  const paint = () => {
    host.innerHTML = controller.page();
    controller.bind(host);
  };
  const select = (element, value) => {
    for (const option of element.options) {
      if (option.value === value) option.setAttribute("selected", "");
      else option.removeAttribute("selected");
    }
  };
  try {
    paint();
    const input = host.querySelector("[data-binary-file]");
    Object.defineProperty(input, "files", {
      value: [
        {
          name: "original.bin",
          size: original.length,
          arrayBuffer: async () => original.buffer,
        },
      ],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 100 && controller.isBusy; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    host.querySelector("[data-binary-export]").click();
    assert.equal(controller.hasUnsavedData, false);
    const form = host.querySelector("#binary-table-form");
    form.querySelector("[name=offset]").value = "0x8";
    form.querySelector("[name=rows]").value = "2";
    form.querySelector("[name=columns]").value = "3";
    select(form.querySelector("[name=type]"), "uint16");
    select(form.querySelector("[name=endian]"), "big");
    form
      .querySelector("[name=offset]")
      .dispatchEvent(new Event("input", { bubbles: true }));
    assert.equal(controller.hasUnsavedData, true);
    assert.equal(await controller.leave(), true);
    host.innerHTML = "<h1>Outra tela</h1>";
    paint();
    const restored = host.querySelector("#binary-table-form");
    for (const [key, value] of Object.entries({
      offset: "0x8",
      rows: "2",
      columns: "3",
      type: "uint16",
      endian: "big",
    }))
      assert.equal(restored.querySelector(`[name="${key}"]`).value, value, key);
    // A tabela aplicada continua sendo a anterior; exportar um rascunho é recusado.
    host.querySelector("[data-binary-export]").click();
    assert.equal(snapshots.length, 1);
    assert.match(notices.at(-1), /Aplique o recorte/);
    restored.querySelector("[name=offset]").value = "0x";
    restored
      .querySelector("[name=offset]")
      .dispatchEvent(new Event("input", { bubbles: true }));
    paint();
    const invalid = host.querySelector("#binary-table-form");
    assert.equal(invalid.querySelector("[name=offset]").value, "0x");
    invalid.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    assert.match(notices.at(-1), /endereço/);
    assert.equal(controller.hasUnsavedData, true);
    paint();
    const applied = host.querySelector("#binary-table-form");
    applied.querySelector("[name=offset]").value = "0x8";
    applied.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    host.querySelector("[data-binary-export]").click();
    assert.deepEqual(snapshots[1].table.values, [
      [0x0809, 0x0a0b, 0x0c0d],
      [0x0e0f, 0x1011, 0x1213],
    ]);
    assert.equal(controller.hasUnsavedData, false);
    assert.deepEqual(
      original,
      new Uint8Array(Array.from({ length: 32 }, (_, i) => i)),
    );
  } finally {
    controller.dispose();
  }
});
