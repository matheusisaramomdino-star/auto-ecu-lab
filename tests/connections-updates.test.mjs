import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createConnectionController } from "../dist/connections.mjs";
import { WebSerialTransport } from "../dist/transports.mjs";
import { ElmSession } from "../dist/obd.mjs";
import { APP_VERSION } from "../dist/modules.mjs";

test("identificação real sem amostras impede descarte silencioso e mantém versão no JSON", async () => {
  const descriptors = Object.fromEntries(
    ["document", "navigator", "FormData", "confirm"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const originals = {
    connect: WebSerialTransport.connect,
    initialize: ElmSession.prototype.initialize,
    identify: ElmSession.prototype.identify,
  };
  const { document, Event } = parseHTML(
    "<html><body><main></main></body></html>",
  ).window;
  const vehicles = [
    {
      id: "v1",
      brand: "Fiat",
      model: "Strada",
      year: 2022,
      engine: "1.4",
      ecu: {},
    },
  ];
  let opens = 0,
    confirmations = 0;
  const downloads = [];
  const replace = (key, value) =>
    Object.defineProperty(globalThis, key, { value, configurable: true });
  replace("document", document);
  replace("navigator", { serial: { requestPort() {} }, userAgent: "Windows" });
  replace(
    "FormData",
    class {
      get(key) {
        return (
          {
            vehicleId: "v1",
            connectionType: "serial",
            baudRate: "38400",
            realAcknowledged: "on",
          }[key] || ""
        );
      }
    },
  );
  replace("confirm", () => {
    confirmations++;
    return false;
  });
  WebSerialTransport.connect = async () => {
    opens++;
    return {
      isConnected: true,
      name: "Mock serial",
      type: "serial",
      async request() {
        throw new Error("O mock de interface não deve consultar hardware.");
      },
      async close() {
        this.isConnected = false;
      },
    };
  };
  ElmSession.prototype.initialize = async () => ({
    ecuId: "7E8",
    adapter: "ELM327 fictício",
  });
  ElmSession.prototype.identify = async () => ({
    ecuId: "7E8",
    vin: "TESTE1234567890123",
    calibrationIds: [],
  });
  const controller = createConnectionController({
    notify() {},
    onSave: async () => {},
    download: (...args) => downloads.push(args),
  });
  const host = document.querySelector("main");
  host.innerHTML = controller.page(vehicles);
  controller.bind(host, vehicles);
  const until = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error("A operação de teste não terminou.");
  };
  const click = (action) =>
    host
      .querySelector(`[data-live-action="${action}"]`)
      .dispatchEvent(new Event("click", { bubbles: true }));
  const connect = () =>
    host
      .querySelector("#connect-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  try {
    connect();
    await until(() => controller.hasSession && !controller.isBusy);
    click("identify");
    await until(() => controller.hasUnsavedData && !controller.isBusy);
    click("disconnect");
    await until(() => !controller.hasSession);
    assert.equal(controller.hasUnsavedData, true);
    click("export");
    await until(() => downloads.length === 1);
    assert.equal(JSON.parse(downloads[0][0]).version, APP_VERSION);
    assert.equal(
      JSON.parse(downloads[0][0]).identity.vin,
      "TESTE1234567890123",
    );
    connect();
    await until(() => confirmations === 1);
    assert.equal(opens, 1);
    assert.equal(controller.hasUnsavedData, true);
  } finally {
    await controller.leave();
    WebSerialTransport.connect = originals.connect;
    ElmSession.prototype.initialize = originals.initialize;
    ElmSession.prototype.identify = originals.identify;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
