import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createConnectionController } from "../dist/connections.mjs";
import { ElmSession } from "../dist/obd.mjs";
import { WebSerialTransport } from "../dist/transports.mjs";

test("sensores exigem clique, preservam estado pendente e são exportados/salvos sem alterar pedal", async () => {
  const descriptors = Object.fromEntries(
    ["document", "navigator", "FormData", "confirm"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const methods = {
    connect: WebSerialTransport.connect,
    initialize: ElmSession.prototype.initialize,
    sensors: ElmSession.prototype.readSensors,
    signals: ElmSession.prototype.readSignals,
  };
  const { document, Event } = parseHTML(
    "<html><body><main></main></body></html>",
  ).window;
  const replace = (key, value) =>
    Object.defineProperty(globalThis, key, { value, configurable: true });
  const vehicle = {
    id: "v1",
    brand: "Fiat",
    model: "Strada",
    year: 2022,
    engine: "1.4",
    ecu: {},
  };
  const downloaded = [],
    saved = [],
    notices = [];
  let sensorCalls = 0,
    frames = 0,
    allowed = true;
  replace("document", document);
  replace("navigator", { serial: { requestPort() {} }, userAgent: "Windows" });
  replace("confirm", () => true);
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
  WebSerialTransport.connect = async () => ({
    type: "serial",
    isConnected: true,
    name: "Teste",
    async request() {
      throw Error("Mock não acessa hardware");
    },
    async close() {
      this.isConnected = false;
    },
  });
  ElmSession.prototype.initialize = async () => ({
    ecuId: "7E8",
    sourceMode: "real",
  });
  ElmSession.prototype.readSensors = async () => {
    sensorCalls++;
    return {
      ecuId: "7E8",
      sourceMode: "real",
      acquired_at_utc: "2026-11-06T14:00:00Z",
      time_s: sensorCalls,
      sensors: [
        {
          key: "coolant_c",
          pid: "05",
          label: "Arrefecimento",
          unit: "°C",
          value: 90,
          supported: true,
          status: "ok",
          ecuId: "7E8",
          observed_at_s: sensorCalls,
          raw_bytes: [130],
        },
        {
          key: "maf_gps",
          pid: "10",
          label: "Massa de ar",
          unit: "g/s",
          value: null,
          supported: false,
          status: "unsupported",
          ecuId: "7E8",
          observed_at_s: null,
          raw_bytes: null,
        },
      ],
      errors: [],
    };
  };
  ElmSession.prototype.readSignals = async () => ({
    time_s: ++frames,
    pedal_pct: 20,
    throttle_pct: 10,
    rpm: 850,
    ecuId: "7E8",
    channels: {},
    errors: [],
  });
  const controller = createConnectionController({
    notify: (...args) => notices.push(args),
    download: (...args) => downloaded.push(args),
    onSave: async (value) => saved.push(value),
    canOperate: () => allowed,
  });
  const host = document.querySelector("main");
  const until = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw Error("Operação não terminou: " + JSON.stringify(notices));
  };
  const click = (action) =>
    host
      .querySelector(`[data-live-action="${action}"]`)
      .dispatchEvent(new Event("click", { bubbles: true }));
  try {
    host.innerHTML = controller.page([vehicle]);
    controller.bind(host, [vehicle]);
    assert.equal(host.querySelectorAll(".scanner-card").length, 1);
    assert.match(host.querySelector(".scanner-card").textContent, /ELM327/);
    assert.equal(
      host.querySelector('[data-live-action="sensors"]').disabled,
      true,
    );
    assert.equal(sensorCalls, 0);
    host
      .querySelector("#connect-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => controller.hasSession && !controller.isBusy);
    assert.equal(sensorCalls, 0, "conectar não faz leitura dos sensores");
    click("sensors");
    await until(() => sensorCalls === 1 && !controller.isBusy);
    assert.equal(controller.hasUnsavedData, true);
    assert.match(
      host.querySelector('[data-sensor-value="coolant_c"]').textContent,
      /90.*°C/,
    );
    assert.equal(
      host.querySelector('[data-sensor-value="maf_gps"]').textContent,
      "Não oferecido pela ECU",
    );
    assert.equal(
      host.querySelector('[data-live-action="export"]').disabled,
      false,
    );
    click("export");
    await until(() => downloaded.length === 1);
    const exported = JSON.parse(downloaded[0][0]);
    assert.equal(exported.sensor_snapshot.sensors[0].value, 90);
    assert.equal(exported.sensor_snapshot.sensors[1].value, null);
    assert.deepEqual(exported.frames, []);
    allowed = false;
    click("sensors");
    await until(() => notices.length > 1);
    assert.equal(
      sensorCalls,
      1,
      "barreira de atualização bloqueia nova leitura",
    );
    allowed = true;
    for (let i = 0; i < 2; i++) {
      click("sample");
      await until(() => frames === i + 1 && !controller.isBusy);
    }
    click("save");
    await until(() => saved.length === 1 && !controller.isBusy);
    assert.equal(saved[0].metadata.sensor_snapshot.sensors[0].pid, "05");
    assert.equal(saved[0].samples.length, 2);
    assert.equal(saved[0].samples[0].coolant_c, undefined);
    assert.equal(controller.hasUnsavedData, false);
    click("sensors");
    await until(() => sensorCalls === 2 && !controller.isBusy);
    assert.equal(controller.hasUnsavedData, true);
    click("disconnect");
    await until(() => !controller.hasSession);
    click("export");
    await until(() => downloaded.length === 2);
    assert.equal(JSON.parse(downloaded[1][0]).sensor_snapshot.time_s, 2);
    click("discard");
    await until(() => !controller.hasUnsavedData);
    assert.match(
      host.querySelector("#live-sensors").textContent,
      /Nenhum sensor adicional/,
    );
  } finally {
    await controller.leave();
    WebSerialTransport.connect = methods.connect;
    ElmSession.prototype.initialize = methods.initialize;
    ElmSession.prototype.readSensors = methods.sensors;
    ElmSession.prototype.readSignals = methods.signals;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
