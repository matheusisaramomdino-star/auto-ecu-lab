import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createConnectionController } from "../dist/connections.mjs";

function navigatorFor(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
}
const vehicles = [
  {
    id: "v1",
    brand: "Fiat",
    model: "Strada",
    year: 2022,
    engine: "1.4",
    plate: "",
    ecu: { source: "Não confirmada" },
  },
];
function setup(navigator = {}) {
  const oldDocument = globalThis.document,
    oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const { document } = parseHTML("<html><body><main></main></body></html>");
  globalThis.document = document;
  navigatorFor(navigator);
  const notices = [],
    downloads = [],
    saved = [];
  const controller = createConnectionController({
    notify: (...args) => notices.push(args),
    download: (...args) => downloads.push(args),
    onSave: async (value) => saved.push(value),
  });
  const host = document.querySelector("main");
  host.innerHTML = controller.page(vehicles);
  controller.bind(host, vehicles);
  return {
    controller,
    host,
    notices,
    downloads,
    saved,
    cleanup: async () => {
      await controller.leave();
      globalThis.document = oldDocument;
      if (oldNavigator)
        Object.defineProperty(globalThis, "navigator", oldNavigator);
      else delete globalThis.navigator;
    },
  };
}
test("renderizar monitor real não conecta hardware nem inventa sinais ou diagnóstico", async () => {
  let requests = 0;
  const fixture = setup({
    userAgent: "Windows",
    serial: {
      requestPort: () => {
        requests++;
      },
    },
  });
  try {
    assert.equal(requests, 0);
    assert.equal(fixture.controller.hasSession, false);
    assert.equal(
      fixture.host.querySelector('[data-live-signal="rpm"]').textContent,
      "Não disponível",
    );
    assert.match(
      fixture.host.querySelector("#live-dtc").textContent,
      /ainda não consultados/,
    );
    assert.equal(
      fixture.host.querySelector('[data-live-action="start"]').disabled,
      true,
    );
    assert.equal(
      fixture.host.querySelector('[data-live-action="save"]').disabled,
      true,
    );
    assert.equal(fixture.saved.length, 0);
  } finally {
    await fixture.cleanup();
  }
});
test("iOS sem API direta não oferece botão de conexão falso", async () => {
  const fixture = setup({ userAgent: "iPhone" });
  try {
    assert.equal(
      fixture.host.querySelector('#connect-form button[type="submit"]')
        .disabled,
      true,
    );
    assert.match(fixture.host.textContent, /integração nativa autorizada/);
    assert.match(fixture.host.textContent, /J2534/);
    assert.match(fixture.host.textContent, /Rasther/);
  } finally {
    await fixture.cleanup();
  }
});
test("texto de veículo importado é escapado e deixa dados reais separados da simulação", async () => {
  const fixture = setup();
  try {
    const html = fixture.controller.page([
      { ...vehicles[0], model: "<img src=x onerror=alert(1)>" },
    ]);
    assert.ok(!html.includes("<img src=x"));
    assert.match(html, /&lt;img/);
    assert.match(html, /OPERAÇÃO REAL/);
    assert.match(html, /Nenhuma simulação será enviada/);
  } finally {
    await fixture.cleanup();
  }
});
