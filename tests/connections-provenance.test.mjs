import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createConnectionController } from "../dist/connections.mjs";
import { WebSerialTransport } from "../dist/transports.mjs";
import { ElmSession } from "../dist/obd.mjs";
import { provenanceStatus, summarizeRecordings } from "../dist/statistics.mjs";

test("captura preserva origem e UUID entre salvamentos; reconexão inicia outra captura", async () => {
  const descriptors = Object.fromEntries(
    ["document", "navigator", "FormData", "confirm"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const originals = {
    connect: WebSerialTransport.connect,
    initialize: ElmSession.prototype.initialize,
    readSignals: ElmSession.prototype.readSignals,
  };
  const { document, Event } = parseHTML(
    "<html><body><main></main></body></html>",
  ).window;
  const vehicle = {
    id: "v1",
    brand: "Fiat",
    model: "Strada",
    year: 2022,
    engine: "1.4",
    ecu: {
      identification: "",
      hardware: "",
      software: "",
      source: "Não confirmada",
    },
  };
  const saved = [],
    downloads = [],
    notices = [];
  let ticks = 0,
    connections = 0;
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
    throw new Error("Dados salvos não exigem confirmação de descarte.");
  });
  WebSerialTransport.connect = async () => ({
    isConnected: true,
    type: "serial",
    name: "Adaptador de teste",
    async request() {
      throw new Error("Este teste não consulta hardware.");
    },
    async close() {
      this.isConnected = false;
    },
  });
  ElmSession.prototype.initialize = async () => {
    ticks = 0;
    connections++;
    // A segunda conexão testa a ausência de origem: o controlador não inventa CAN ID.
    return connections === 1
      ? { ecuId: "7E8", sourceMode: "real" }
      : { sourceMode: "real" };
  };
  ElmSession.prototype.readSignals = async () => {
    ticks++;
    const ecuId = connections === 1 ? "7E8" : undefined;
    return {
      time_s: ticks / 10,
      pedal_pct: ticks >= 2 ? 40 : 0,
      throttle_pct: ticks >= 3 ? 35 : 5,
      rpm: 850,
      ecuId,
      sourceMode: "real",
      channels: { pedal_pct: { ecuId, pid: "49", observed_at_s: ticks / 10 } },
      errors: [],
    };
  };
  const controller = createConnectionController({
    notify: (...args) => notices.push(args),
    download: (...args) => downloads.push(args),
    onSave: async (value) => saved.push(structuredClone(value)),
  });
  const host = document.querySelector("main");
  host.innerHTML = controller.page([vehicle]);
  controller.bind(host, [vehicle]);
  const until = async (condition) => {
    for (let index = 0; index < 100; index++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(
      `Operação do teste não terminou: ${JSON.stringify(notices)}`,
    );
  };
  const click = (action) =>
    host
      .querySelector(`[data-live-action="${action}"]`)
      .dispatchEvent(new Event("click", { bubbles: true }));
  const connect = async () => {
    host
      .querySelector("#connect-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => controller.hasSession && !controller.isBusy);
  };
  const read = async (count) => {
    for (let index = 0; index < count; index++) {
      const previous = ticks;
      click("sample");
      await until(() => ticks > previous && !controller.isBusy);
    }
  };
  const recording = (value, index) => ({
    ...value,
    id: `r${index}`,
    isDemo: false,
    vehicle,
  });
  try {
    await connect();
    await read(2);
    click("save");
    await until(() => saved.length === 1 && !controller.isBusy);
    const first = saved[0];
    assert.match(
      first.metadata.capture_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(
      first.metadata.capture_id,
      first.metadata.connection.capture_id,
    );
    assert.equal(first.metadata.identity, null);
    assert.equal(first.metadata.connection.adapter.ecuId, "7E8");
    assert.equal(first.metadata.channel_timestamps[0].ecuId, "7E8");
    assert.equal(
      first.metadata.provenance.captured_at,
      first.metadata.connection.started_at_utc,
    );
    assert.equal(
      first.metadata.provenance.reference,
      first.metadata.capture_id,
    );
    assert.equal(first.metadata.provenance.verification, "protocol_capture");
    assert.deepEqual(first.metadata.signal_definitions, {
      time_s: "monotonic_seconds",
      pedal_pct: "OBD-II 01 49 percent",
      throttle_pct: "OBD-II 01 11 percent",
      rpm: "OBD-II 01 0C rpm",
    });
    assert.equal(provenanceStatus(recording(first, 1)).eligible, true);
    await read(1);
    click("save");
    await until(() => saved.length === 2 && !controller.isBusy);
    assert.equal(saved[1].metadata.capture_id, first.metadata.capture_id);
    const summary = summarizeRecordings(saved.map(recording));
    assert.equal(summary.totals.sessions, 1);
    assert.equal(summary.totals.samples, 3);
    click("export");
    await until(() => downloads.length === 1);
    const exported = JSON.parse(downloads[0][0]);
    assert.equal(exported.capture_id, first.metadata.capture_id);
    assert.deepEqual(exported.provenance, first.metadata.provenance);
    assert.deepEqual(
      exported.signal_definitions,
      first.metadata.signal_definitions,
    );
    click("disconnect");
    await until(() => !controller.hasSession);
    await connect();
    await read(2);
    click("save");
    await until(() => saved.length === 3 && !controller.isBusy);
    assert.notEqual(saved[2].metadata.capture_id, first.metadata.capture_id);
    assert.equal(saved[2].metadata.identity, null);
    assert.equal(saved[2].metadata.connection.adapter.ecuId, undefined);
    assert.equal(saved[2].metadata.channel_timestamps[0].ecuId, undefined);
    assert.equal(provenanceStatus(recording(saved[2], 3)).eligible, false);
  } finally {
    await controller.leave();
    WebSerialTransport.connect = originals.connect;
    ElmSession.prototype.initialize = originals.initialize;
    ElmSession.prototype.readSignals = originals.readSignals;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
