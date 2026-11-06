import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BINARY_TYPES,
  MAX_BINARY_BYTES,
  binaryOffset,
  inspectBinary,
  readTable,
} from "../dist/binary.mjs";

test("inspeção mede bytes reais, SHA-256, histograma e entropia conhecidos", async () => {
  const bytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
  const original = bytes.slice();
  const result = await inspectBinary(bytes);
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.entropy_bits_per_byte, 8);
  assert.equal(result.zero_fraction, 1 / 256);
  assert.equal(result.ff_fraction, 1 / 256);
  assert.equal(
    result.byte_histogram.reduce((a, b) => a + b),
    256,
  );
  assert.equal(result.hex_preview.length, 16);
  assert.equal(
    result.hex_preview[0].hex,
    "00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F",
  );
  assert.deepEqual(bytes, original);
  assert.equal(result.interpretation, "generic_bytes_read_only");
});

test("retrato consistente não mistura digest e histograma após mutação do chamador", async () => {
  const bytes = new TextEncoder().encode("abc");
  const pending = inspectBinary(bytes);
  bytes.fill(0);
  const result = await pending;
  assert.equal(
    result.sha256,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(result.zero_bytes, 0);
  assert.equal(result.hex_preview[0].ascii, "abc");
});

test("preenchimento uniforme e strings têm limites explícitos, sem inferência de ECU", async () => {
  const repeated = await inspectBinary(new Uint8Array(300).fill(255));
  assert.equal(repeated.entropy_bits_per_byte, 0);
  assert.equal(repeated.ff_fraction, 1);
  assert.equal(repeated.hex_preview.length, 16);
  assert.equal(repeated.hex_preview.at(-1).offset, 240);
  const text = await inspectBinary(
    new TextEncoder().encode("A".repeat(100) + "\0" + "<script>"),
  );
  assert.equal(text.strings[0].length, 100);
  assert.equal(text.strings[0].text.length, 80);
  assert.equal(text.strings[0].truncated, true);
  assert.equal(text.strings[1].offset, 101);
  assert.ok(!Object.hasOwn(text, "ecu"));
});

test("offset aceita somente decimal inteiro ou hexadecimal explícito", () => {
  assert.equal(binaryOffset("0x1f"), 31);
  assert.equal(binaryOffset(" 42 "), 42);
  for (const value of [
    -1,
    1.5,
    Infinity,
    NaN,
    true,
    null,
    "",
    "1e3",
    "-2",
    "0x",
    "0b10",
    "0x20000000000000",
  ])
    assert.throws(() => binaryOffset(value));
});

test("recorte uint16 respeita endian, offset hexadecimal e subarray", () => {
  const original = new Uint8Array([99, 0x34, 0x12, 0x78, 0x56, 99]);
  const slice = original.subarray(1, 5);
  const before = original.slice();
  assert.deepEqual(
    readTable(slice, { rows: 1, columns: 2, type: "uint16", endian: "little" })
      .values,
    [[0x1234, 0x5678]],
  );
  assert.deepEqual(
    readTable(slice, { rows: 1, columns: 2, type: "uint16", endian: "big" })
      .values,
    [[0x3412, 0x7856]],
  );
  assert.equal(
    readTable(slice, { offset: "0x2", rows: 1, columns: 1, type: "uint16" })
      .values[0][0],
    0x5678,
  );
  assert.deepEqual(original, before);
});

for (const [type, value] of [
  ["uint8", 255],
  ["int8", -128],
  ["uint16", 65535],
  ["int16", -32768],
  ["uint32", 4294967295],
  ["int32", -2147483648],
  ["float32", 1.25],
]) {
  test(`leitura ${type} conserva sinal e tamanho`, () => {
    const size = BINARY_TYPES[type].bytes;
    const buffer = new ArrayBuffer(size);
    const setter = BINARY_TYPES[type].method.replace("get", "set");
    new DataView(buffer)[setter](0, value, true);
    const result = readTable(buffer, { rows: 1, columns: 1, type });
    assert.equal(result.values[0][0], value);
    assert.equal(result.byte_length, size);
    assert.equal(result.end_offset_exclusive, size);
    assert.equal(result.units, "raw");
  });
}

test("rejeita faixa fora do arquivo, dimensões inválidas e formatos desconhecidos", async () => {
  const bytes = new Uint8Array(16);
  for (const options of [
    { offset: 17, rows: 1, columns: 1 },
    { offset: 15, rows: 1, columns: 1, type: "uint16" },
    { rows: 0 },
    { rows: 33 },
    { columns: 1.5 },
    { columns: "1e1" },
    { type: "constructor" },
    { type: "float64" },
    { endian: "native" },
  ])
    assert.throws(() => readTable(bytes, options));
  assert.throws(
    () =>
      readTable(new Uint8Array(MAX_BINARY_BYTES + 1), { rows: 1, columns: 1 }),
    /8 MiB/,
  );
  await assert.rejects(inspectBinary(new Uint8Array()), /vazio/);
  await assert.rejects(inspectBinary("firmware"), /válido/);
  const nan = new ArrayBuffer(4);
  new DataView(nan).setFloat32(0, NaN, true);
  assert.throws(
    () => readTable(nan, { rows: 1, columns: 1, type: "float32" }),
    /não finito/,
  );
});
