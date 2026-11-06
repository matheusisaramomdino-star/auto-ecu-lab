/** Inspeção genérica de bytes locais. Não identifica ECU nem altera o arquivo. */
export const MAX_BINARY_BYTES = 8 * 1024 * 1024;
export const MAX_TABLE_DIMENSION = 32;
export const BINARY_TYPES = Object.freeze({
  uint8: Object.freeze({
    bytes: 1,
    method: "getUint8",
    label: "Inteiro sem sinal · 8 bits",
  }),
  int8: Object.freeze({
    bytes: 1,
    method: "getInt8",
    label: "Inteiro com sinal · 8 bits",
  }),
  uint16: Object.freeze({
    bytes: 2,
    method: "getUint16",
    label: "Inteiro sem sinal · 16 bits",
  }),
  int16: Object.freeze({
    bytes: 2,
    method: "getInt16",
    label: "Inteiro com sinal · 16 bits",
  }),
  uint32: Object.freeze({
    bytes: 4,
    method: "getUint32",
    label: "Inteiro sem sinal · 32 bits",
  }),
  int32: Object.freeze({
    bytes: 4,
    method: "getInt32",
    label: "Inteiro com sinal · 32 bits",
  }),
  float32: Object.freeze({
    bytes: 4,
    method: "getFloat32",
    label: "Ponto flutuante · IEEE 754 de 32 bits",
  }),
});

function bytesOf(buffer) {
  let bytes;
  if (buffer instanceof ArrayBuffer) bytes = new Uint8Array(buffer);
  else if (ArrayBuffer.isView(buffer) && buffer.buffer instanceof ArrayBuffer)
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  else throw new Error("Selecione um arquivo binário válido.");
  if (!bytes.byteLength) throw new Error("O arquivo BIN está vazio.");
  if (bytes.byteLength > MAX_BINARY_BYTES)
    throw new Error("O arquivo BIN pode ter até 8 MiB.");
  return bytes;
}

export function binaryOffset(value) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text))
      throw new Error(
        "Informe o endereço em decimal ou hexadecimal com prefixo 0x.",
      );
    value = Number(text);
  }
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("O endereço precisa ser um inteiro não negativo.");
  return value;
}

function dimension(value) {
  if (typeof value === "string") {
    if (!/^[0-9]+$/.test(value.trim()))
      throw new Error("Linhas e colunas precisam ser inteiros de 1 a 32.");
    value = Number(value);
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TABLE_DIMENSION)
    throw new Error("Linhas e colunas precisam ser inteiros de 1 a 32.");
  return value;
}

/** O operador define o recorte. Cada valor é lido uma vez, sem escalas inferidas. */
export function readTable(
  buffer,
  { offset = 0, rows = 8, columns = 8, type = "uint8", endian = "little" } = {},
) {
  const bytes = bytesOf(buffer);
  offset = binaryOffset(offset);
  rows = dimension(rows);
  columns = dimension(columns);
  if (!Object.hasOwn(BINARY_TYPES, type))
    throw new Error("Tipo numérico não suportado.");
  if (!["little", "big"].includes(endian))
    throw new Error("Ordem de bytes inválida.");
  const format = BINARY_TYPES[type];
  const length = rows * columns * format.bytes;
  if (offset > bytes.byteLength || length > bytes.byteLength - offset)
    throw new Error(
      "O recorte ultrapassa o fim do arquivo. Reduza o endereço ou as dimensões.",
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = [];
  let minimum = Infinity,
    maximum = -Infinity;
  for (let row = 0; row < rows; row++) {
    const valuesInRow = [];
    for (let column = 0; column < columns; column++) {
      const address = offset + (row * columns + column) * format.bytes;
      const value = view[format.method](address, endian === "little");
      if (!Number.isFinite(value))
        throw new Error(
          `Valor não finito no endereço 0x${address.toString(16).toUpperCase()}. Escolha outro recorte ou tipo.`,
        );
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      valuesInRow.push(value);
    }
    values.push(valuesInRow);
  }
  return {
    offset,
    rows,
    columns,
    type,
    endian,
    bytes_per_value: format.bytes,
    byte_length: length,
    end_offset_exclusive: offset + length,
    min: minimum,
    max: maximum,
    values,
    units: "raw",
  };
}

function textFragments(bytes) {
  const strings = [];
  let index = 0;
  while (index < bytes.length && strings.length < 24) {
    const start = index;
    let text = "";
    while (index < bytes.length && bytes[index] >= 32 && bytes[index] <= 126) {
      if (text.length < 80) text += String.fromCharCode(bytes[index]);
      index++;
    }
    const length = index - start;
    if (length >= 4)
      strings.push({ offset: start, text, length, truncated: length > 80 });
    if (index < bytes.length) index++;
  }
  return { strings, string_scan_limited: index < bytes.length };
}

/** SHA-256 corresponde aos bytes fornecidos; não certifica checksum ou origem. */
export async function inspectBinary(buffer) {
  // O digest é assíncrono: o retrato impede que alterações do chamador misturem
  // histogramas de uma versão com o hash de outra.
  const bytes = bytesOf(buffer).slice();
  const histogram = Array(256).fill(0);
  for (const value of bytes) histogram[value]++;
  let entropy = 0;
  for (const count of histogram) {
    if (!count) continue;
    const probability = count / bytes.length;
    entropy -= probability * Math.log2(probability);
  }
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Este navegador não oferece SHA-256. Abra o aplicativo pelo endereço HTTPS.",
    );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const preview = [];
  for (let offset = 0; offset < Math.min(bytes.length, 256); offset += 16) {
    const row = bytes.subarray(
      offset,
      offset + Math.min(16, bytes.length - offset),
    );
    preview.push({
      offset,
      hex: Array.from(row, (value) =>
        value.toString(16).padStart(2, "0").toUpperCase(),
      ).join(" "),
      ascii: Array.from(row, (value) =>
        value >= 32 && value <= 126 ? String.fromCharCode(value) : ".",
      ).join(""),
    });
  }
  return {
    byte_length: bytes.length,
    sha256,
    entropy_bits_per_byte: Math.min(8, entropy),
    zero_bytes: histogram[0],
    ff_bytes: histogram[255],
    zero_fraction: histogram[0] / bytes.length,
    ff_fraction: histogram[255] / bytes.length,
    byte_histogram: histogram,
    hex_preview: preview,
    ...textFragments(bytes),
    interpretation: "generic_bytes_read_only",
    limitations:
      "Inspeção genérica de bytes; não identifica ECU, mapas, função dos dados ou validade de checksum. Eixos e unidades dependem de documentação externa.",
  };
}
