import test from "node:test";
import assert from "node:assert/strict";
import {
  ElmSession,
  OBD_SENSORS,
  assertReadOnlyCommand,
} from "../dist/obd.mjs";

// Bytes artificiais exclusivamente para testes do protocolo; não são medições.
const hex = (value) => value.toString(16).toUpperCase().padStart(2, "0");
const can = (payload, ecu = "7E8") =>
  `${ecu} ${[payload.length, ...payload].map(hex).join(" ")}\r>`;
function mask(base, pids) {
  let bits = 0;
  for (const pid of pids)
    if (pid > base && pid <= base + 32)
      bits = (bits | (1 << (32 - (pid - base)))) >>> 0;
  return can([
    0x41,
    base,
    (bits >>> 24) & 255,
    (bits >>> 16) & 255,
    (bits >>> 8) & 255,
    bits & 255,
  ]);
}
function fixture({
  supported = [4, 5, 11, 13, 15, 16, 0x20, 0x40, 0x42],
  responses = {},
} = {}) {
  const values = {
    ATZ: "ELM327 test\r>",
    ATI: "ELM327 test\r>",
    ATDPN: "A6\r>",
    "0100": mask(0, supported),
    "0120": mask(0x20, supported),
    "0140": mask(0x40, supported),
    "0104": can([0x41, 4, 0x80]),
    "0105": can([0x41, 5, 0x82]),
    "010B": can([0x41, 11, 0x64]),
    "010D": can([0x41, 13, 0]),
    "010F": can([0x41, 15, 0x3c]),
    "0110": can([0x41, 16, 0x01, 0xf4]),
    "0142": can([0x41, 0x42, 0x36, 0xb0]),
    ...responses,
  };
  const commands = [];
  let ticks = 1000;
  const transport = {
    commands,
    isConnected: true,
    async request(command) {
      commands.push(command);
      return values[command] ?? "OK\r>";
    },
    async close() {
      this.isConnected = false;
    },
  };
  return {
    session: new ElmSession(transport, { clock: () => (ticks += 10) }),
    transport,
  };
}

test("sensores são consultas Mode 01 permitidas; não liberam Mode 04 ou gravação", () => {
  for (const sensor of OBD_SENSORS)
    assert.equal(assertReadOnlyCommand("01" + sensor.pid), "01" + sensor.pid);
  for (const command of [
    "04",
    "08",
    "2E0142FFFF",
    "3101FFFF",
    "0112",
    "ATSH7E0",
  ])
    assert.throws(
      () => assertReadOnlyCommand(command),
      (error) => error.code === "COMMAND_BLOCKED",
    );
});

test("leitura pontual decodifica vetores conhecidos e preserva ECU, unidades e tempos", async () => {
  const { session, transport } = fixture();
  await assert.rejects(
    session.readSensors(),
    (error) => error.code === "NOT_INITIALIZED",
  );
  await session.initialize();
  assert.ok(
    !transport.commands.includes("0105"),
    "inicialização não consulta sensores",
  );
  const snapshot = await session.readSensors();
  assert.equal(snapshot.ecuId, "7E8");
  assert.equal(snapshot.sourceMode, "real");
  assert.ok(Number.isFinite(Date.parse(snapshot.acquired_at_utc)));
  const byKey = Object.fromEntries(
    snapshot.sensors.map((reading) => [reading.key, reading]),
  );
  assert.equal(byKey.coolant_c.value, 90);
  assert.equal(byKey.intake_c.value, 20);
  assert.equal(byKey.map_kpa.value, 100);
  assert.equal(
    byKey.speed_kmh.value,
    0,
    "zero recebido é distinto de ausência",
  );
  assert.equal(byKey.maf_gps.value, 5);
  assert.equal(byKey.module_voltage_v.value, 14);
  assert.equal(byKey.engine_load_pct.value, (128 * 100) / 255);
  assert.equal(byKey.module_voltage_v.unit, "V");
  assert.deepEqual(byKey.maf_gps.raw_bytes, [1, 244]);
  assert.deepEqual(snapshot.errors, []);
  assert.ok(
    snapshot.sensors.every(
      (reading) =>
        reading.status === "ok" &&
        reading.supported &&
        reading.ecuId === "7E8" &&
        reading.observed_at_s > 0 &&
        reading.acquisition_s > 0,
    ),
  );
  assert.ok(
    byKey.coolant_c.observed_at_s < byKey.module_voltage_v.observed_at_s,
  );
  assert.ok(
    transport.commands.every((command) => assertReadOnlyCommand(command)),
  );
});

test("máscara sem PID preserva ausência como null sem enviar consulta", async () => {
  const { session, transport } = fixture({ supported: [5] });
  await session.initialize();
  const result = await session.readSensors();
  const voltage = result.sensors.find((reading) => reading.pid === "42");
  assert.equal(voltage.value, null);
  assert.equal(voltage.status, "unsupported");
  assert.equal(voltage.supported, false);
  assert.equal(voltage.raw_bytes, null);
  assert.ok(!transport.commands.includes("0142"));
  assert.ok(!transport.commands.includes("0120"));
  assert.equal(
    result.sensors.filter((reading) => reading.status === "ok").length,
    1,
  );
});

test("truncamento, NO DATA e outra ECU não se tornam valores válidos", async () => {
  const { session } = fixture({
    responses: {
      "0105": "NO DATA\r>",
      "0110": can([0x41, 0x10, 0x01]),
      "0142": can([0x41, 0x42, 0x36, 0xb0], "7E9"),
    },
  });
  await session.initialize();
  const result = await session.readSensors();
  assert.equal(result.errors.length, 3);
  for (const key of ["coolant_c", "maf_gps", "module_voltage_v"]) {
    const reading = result.sensors.find((item) => item.key === key);
    assert.equal(reading.value, null);
    assert.equal(reading.status, "error");
    assert.equal(reading.raw_bytes, null);
    assert.equal(reading.ecuId, "7E8");
    assert.ok(reading.error.code);
  }
  assert.equal(
    result.sensors.find((item) => item.key === "map_kpa").value,
    100,
  );
});

test("readSignals mantém exatamente os três canais e não lê sensores adicionais", async () => {
  const { session, transport } = fixture({
    supported: [0x0c, 0x11, 0x20, 0x40, 0x49, 0x05],
    responses: {
      "010C": can([0x41, 0x0c, 0x0f, 0xa0]),
      "0111": can([0x41, 0x11, 0x40]),
      "0149": can([0x41, 0x49, 0x80]),
    },
  });
  await session.initialize();
  transport.commands.length = 0;
  const frame = await session.readSignals();
  assert.deepEqual(transport.commands, ["010C", "0111", "0149"]);
  assert.equal(frame.rpm, 1000);
  assert.deepEqual(Object.keys(frame.channels), [
    "rpm",
    "throttle_pct",
    "pedal_pct",
  ]);
});
