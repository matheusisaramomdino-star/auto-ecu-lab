import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BRAND,
  VEHICLES,
  SCANNERS,
  CONNECTION_MATRIX,
  CONNECTION_STATUSES,
} from "../dist/catalog.mjs";

test("catálogo inclui os sete veículos sem inventar dados desconhecidos de ECU", () => {
  assert.deepEqual(
    VEHICLES.map((v) => v.model),
    ["Hilux", "SW4", "Strada", "S10", "Ranger", "L200", "Amarok"],
  );
  assert.equal(new Set(VEHICLES.map((v) => v.key)).size, 7);
  for (const vehicle of VEHICLES) {
    assert.ok(vehicle.brand && vehicle.label);
    assert.equal("ecu" in vehicle, false);
    if (vehicle.model === "Strada") {
      assert.equal(vehicle.year, 2022);
      assert.equal(vehicle.engine, "1.4");
    } else {
      assert.equal(vehicle.year, null);
      assert.equal(vehicle.engine, "");
    }
  }
});
test("scanners proprietários ficam condicionados a integração autorizada", () => {
  assert.equal(SCANNERS.find((s) => s.key === "elm327").status, "implementado");
  for (const key of ["j2534", "rasther", "sdk"]) {
    const scanner = SCANNERS.find((s) => s.key === key);
    assert.equal(scanner.status, "depende");
    assert.ok(scanner.requirements.length >= 3);
  }
  assert.match(SCANNERS.find((s) => s.key === "rasther").description, /CSV/);
  assert.match(
    SCANNERS.find((s) => s.key === "rasther").description,
    /autorizada/,
  );
});
test("matriz cobre cada conexão nas três plataformas com estados explícitos", () => {
  assert.equal(CONNECTION_MATRIX.length, 12);
  for (const platform of ["Windows", "Android", "iOS"]) {
    const rows = CONNECTION_MATRIX.filter((row) => row.platform === platform);
    assert.deepEqual(
      rows.map((row) => row.connection),
      ["Bluetooth BLE", "Bluetooth Classic", "Wi-Fi", "USB"],
    );
    for (const row of rows) {
      assert.ok(CONNECTION_STATUSES[row.status]);
      assert.ok(row.browser && row.description && row.nativeRequirement);
    }
  }
});
test("iOS não promete APIs BLE, Classic ou USB ao Safari; Android usa detecção real", () => {
  for (const connection of ["Bluetooth BLE", "Bluetooth Classic", "USB"])
    assert.equal(
      CONNECTION_MATRIX.find(
        (row) => row.platform === "iOS" && row.connection === connection,
      ).status,
      "indisponível",
    );
  const androidSerial = CONNECTION_MATRIX.find(
    (row) =>
      row.platform === "Android" && row.connection === "Bluetooth Classic",
  );
  assert.match(androidSerial.browser, /navigator\.serial/);
  assert.match(androidSerial.description, /API real/);
});
test("marca, manifesto e estilo preservam a paleta solicitada", async () => {
  assert.equal(BRAND.name, "AUTO ECU LAB — Auto Elétrica Doidinho");
  assert.deepEqual(Object.values(BRAND.colors), [
    "#141414",
    "#242424",
    "#FF8A00",
    "#FFFFFF",
  ]);
  const manifest = JSON.parse(
    await readFile(
      new URL("../dist/manifest.webmanifest", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.name, BRAND.name);
  assert.equal(manifest.theme_color, BRAND.colors.black);
  assert.equal(manifest.background_color, BRAND.colors.black);
  const css = await readFile(
    new URL("../dist/style.css", import.meta.url),
    "utf8",
  );
  for (const color of Object.values(BRAND.colors))
    assert.ok(css.toUpperCase().includes(color));
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /min-height:\s*44px/);
  const html = await readFile(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  assert.ok(html.includes("Auto Elétrica Doidinho"));
  assert.ok(html.includes('<meta name="auto-ecu-lab-app" content="v1">'));
});
