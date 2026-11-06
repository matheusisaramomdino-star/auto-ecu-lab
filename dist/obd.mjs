/** OBD-II de leitura por ELM327 documentado; perfil CAN ISO 15765, 11 bits.
 * Fonte: ELM327DSK, Elm Electronics, pp. 13–14, 31–35 e 43–44.
 * https://www.elmelectronics.com/wp-content/uploads/2017/01/ELM327DS.pdf
 * Não contém serviços de apagar DTC, atuação, programação ou calibração.
 */
export class ObdError extends Error {
  constructor(message, code = "OBD_ERROR", details = {}) {
    super(message);
    this.name = "ObdError";
    this.code = code;
    this.details = details;
  }
}

const ADAPTER_COMMANDS = new Set([
  "ATZ",
  "ATE0",
  "ATL0",
  "ATS1",
  "ATH1",
  "ATCAF1",
  "ATCFC1",
  "ATSP0",
  "ATDPN",
  "ATI",
]);
const READ_COMMANDS = new Set([
  "0100",
  "0120",
  "0140",
  "010C",
  "0111",
  "0149",
  "0900",
  "0902",
  "0904",
  "0906",
  "03",
  "07",
  "0A",
]);
export const READ_ONLY_COMMANDS = Object.freeze([
  ...ADAPTER_COMMANDS,
  ...READ_COMMANDS,
]);

export function assertReadOnlyCommand(command) {
  if (typeof command !== "string" || /[\r\n\x00>]/.test(command)) {
    throw new ObdError(
      "Comando inválido. O diagnóstico aceita apenas consultas documentadas.",
      "COMMAND_BLOCKED",
    );
  }
  const normalized = command.replace(/ /g, "").toUpperCase();
  if (!ADAPTER_COMMANDS.has(normalized) && !READ_COMMANDS.has(normalized)) {
    throw new ObdError(
      "Comando bloqueado: esta sessão permite somente leitura OBD-II e configuração de apresentação do adaptador.",
      "COMMAND_BLOCKED",
    );
  }
  return normalized;
}

const hex = (value) => value.toString(16).toUpperCase().padStart(2, "0");
function fail(message, code, details) {
  throw new ObdError(message, code, details);
}
function responseLines(raw, request) {
  if (
    typeof raw !== "string" ||
    !raw.trim() ||
    raw.length > 131072 ||
    !raw.includes(">")
  ) {
    fail(
      "Resposta ELM327 incompleta: o prompt final não foi recebido.",
      "INCOMPLETE",
    );
  }
  const beforePrompt = raw.slice(0, raw.indexOf(">"));
  const rest = raw.slice(raw.indexOf(">") + 1);
  if (rest.trim())
    fail("Resposta inesperada após o prompt do adaptador.", "DESYNCHRONIZED");
  const lines = beforePrompt
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const cleaned = [];
  for (const line of lines) {
    if (line.replace(/ /g, "").toUpperCase() === request) continue;
    const searching = line.replace(/^SEARCHING\.{0,3}\s*/i, "");
    if (!searching) continue;
    if (/^(NO DATA)$/i.test(searching))
      fail("A ECU não retornou dados para esta consulta.", "NO_DATA");
    if (
      /\?|ERROR|UNABLE TO CONNECT|STOPPED|BUFFER FULL|BUS BUSY|LV RESET/i.test(
        searching,
      )
    ) {
      fail(`O adaptador informou: ${searching}.`, "ADAPTER_ERROR");
    }
    cleaned.push(searching);
  }
  if (!cleaned.length)
    fail("Nenhuma resposta OBD-II foi recebida.", "NO_RESPONSE");
  return cleaned;
}

/** Reagrupa ISO-TP por CAN ID. Dados sem cabeçalho nunca são atribuídos a uma ECU. */
export function parseCanResponses(raw, request) {
  const normalized = assertReadOnlyCommand(request);
  if (ADAPTER_COMMANDS.has(normalized))
    fail("A consulta precisa ser OBD-II.", "INVALID_REQUEST");
  const responses = new Map();
  const pending = new Map();
  for (const line of responseLines(raw, normalized)) {
    const match =
      /^([0-9A-F]{3})\s+(.+)$/i.exec(line) ||
      /^([0-9A-F]{3})([0-9A-F]{4,16})$/i.exec(line);
    if (
      !match ||
      parseInt(match[1], 16) > 0x7ff ||
      !/^[0-9A-F ]+$/i.test(match[2])
    ) {
      fail(
        "Formato não suportado: exige CAN de 11 bits com cabeçalhos ATH1 e bytes ISO-TP.",
        "UNSUPPORTED_FORMAT",
      );
    }
    const ecuId = match[1].toUpperCase();
    const bytesText = match[2].replace(/ /g, "");
    if (bytesText.length % 2 || bytesText.length > 16)
      fail("Quadro CAN inválido ou truncado.", "MALFORMED");
    const bytes = bytesText.match(/../g).map((byte) => parseInt(byte, 16));
    const type = bytes[0] >> 4;
    if (type === 0) {
      const length = bytes[0] & 15;
      if (
        !length ||
        length > 7 ||
        bytes.length < length + 1 ||
        pending.has(ecuId) ||
        responses.has(ecuId)
      ) {
        fail(
          `Resposta curta, duplicada ou inconsistente da ECU ${ecuId}.`,
          "MALFORMED",
          { ecuId },
        );
      }
      responses.set(ecuId, bytes.slice(1, length + 1));
    } else if (type === 1) {
      const length = ((bytes[0] & 15) << 8) | bytes[1];
      if (
        bytes.length !== 8 ||
        length < 8 ||
        pending.has(ecuId) ||
        responses.has(ecuId)
      ) {
        fail(`Primeiro quadro ISO-TP inválido da ECU ${ecuId}.`, "MALFORMED", {
          ecuId,
        });
      }
      pending.set(ecuId, { length, bytes: bytes.slice(2), sequence: 1 });
    } else if (type === 2) {
      const message = pending.get(ecuId);
      if (
        !message ||
        (bytes[0] & 15) !== message.sequence ||
        bytes.length < 2
      ) {
        fail(`Sequência ISO-TP incorreta da ECU ${ecuId}.`, "SEQUENCE", {
          ecuId,
        });
      }
      const remaining = message.length - message.bytes.length;
      if (bytes.length - 1 < Math.min(remaining, 7))
        fail(`Quadro ISO-TP truncado da ECU ${ecuId}.`, "INCOMPLETE", {
          ecuId,
        });
      message.bytes.push(...bytes.slice(1, Math.min(remaining, 7) + 1));
      message.sequence = (message.sequence + 1) & 15;
      if (message.bytes.length === message.length) {
        responses.set(ecuId, message.bytes);
        pending.delete(ecuId);
      }
    } else {
      fail(
        "Quadro CAN não reconhecido no perfil de leitura OBD-II.",
        "UNSUPPORTED_FORMAT",
        { ecuId },
      );
    }
  }
  if (pending.size)
    fail(
      "Mensagem ISO-TP incompleta; nenhum dado parcial será usado.",
      "INCOMPLETE",
      { responders: [...pending.keys()] },
    );
  if (!responses.size) fail("Nenhuma ECU respondeu à consulta.", "NO_RESPONSE");
  return responses;
}

export function parseElmResponse(raw, { request, ecuId = null } = {}) {
  const normalized = assertReadOnlyCommand(request);
  const responses = parseCanResponses(raw, normalized);
  const responders = [...responses.keys()];
  const chosen =
    ecuId?.toUpperCase() || (responders.length === 1 ? responders[0] : null);
  if (!chosen)
    fail(
      `Mais de uma ECU respondeu (${responders.join(", ")}). Selecione explicitamente o CAN ID antes de continuar.`,
      "AMBIGUOUS_ECU",
      { responders },
    );
  const payload = responses.get(chosen);
  if (!payload)
    fail(`A ECU selecionada ${chosen} não respondeu.`, "ECU_NO_RESPONSE", {
      ecuId: chosen,
      responders,
    });
  const service = parseInt(normalized.slice(0, 2), 16);
  if (payload[0] === 0x7f) {
    if (payload.length !== 3)
      fail("Resposta negativa truncada.", "MALFORMED", { ecuId: chosen });
    if (payload[1] !== service)
      fail(
        `A resposta negativa da ECU ${chosen} pertence a outro serviço.`,
        "WRONG_RESPONSE",
        { ecuId: chosen },
      );
    fail(
      `A ECU ${chosen} rejeitou a consulta ${normalized} (NRC ${hex(payload[2])}).`,
      "NEGATIVE_RESPONSE",
      { ecuId: chosen, nrc: hex(payload[2]) },
    );
  }
  if (
    payload[0] !== service + 0x40 ||
    (normalized.length === 4 &&
      payload[1] !== parseInt(normalized.slice(2), 16))
  ) {
    fail(
      `A resposta da ECU ${chosen} não corresponde à consulta ${normalized}.`,
      "WRONG_RESPONSE",
      { ecuId: chosen },
    );
  }
  return { ecuId: chosen, responders, payload, request: normalized };
}

function supportMask(payload, base) {
  if (payload.length !== 6)
    fail("Lista de PIDs suportados incompleta ou inválida.", "MALFORMED");
  const mask =
    (((payload[2] << 24) >>> 0) |
      (payload[3] << 16) |
      (payload[4] << 8) |
      payload[5]) >>>
    0;
  return Array.from({ length: 32 }, (_, index) => index + 1)
    .filter((index) => (mask >>> (32 - index)) & 1)
    .map((index) => base + index);
}

export function decodeDtc(payload, service = 0x03) {
  if (
    !Array.isArray(payload) ||
    payload.length < 2 ||
    payload[0] !== service + 0x40
  )
    fail("Resposta DTC inválida.", "MALFORMED");
  const count = payload[1];
  const length = 2 + count * 2;
  if (
    payload.length < length ||
    payload.slice(length).some((byte) => byte !== 0)
  )
    fail(
      "Quantidade de DTCs não corresponde aos dados recebidos.",
      "INCOMPLETE",
    );
  const codes = [];
  for (let i = 2; i < length; i += 2) {
    const high = payload[i],
      low = payload[i + 1];
    if (!high && !low)
      fail("A ECU declarou um DTC vazio; resposta inconsistente.", "MALFORMED");
    codes.push(
      "PCBU"[high >> 6] +
        ((high >> 4) & 3) +
        (high & 15).toString(16).toUpperCase() +
        hex(low),
    );
  }
  return codes;
}

function identificationValues(payload, pid) {
  if (payload.length < 3) fail("Identificação da ECU truncada.", "INCOMPLETE");
  const count = payload[2],
    width = pid === 0x02 ? 17 : pid === 0x04 ? 16 : 4;
  if ((pid === 0x02 && count !== 1) || payload.length !== 3 + count * width)
    fail("Contagem da identificação da ECU inválida.", "INCOMPLETE");
  const values = [];
  for (let i = 0; i < count; i++) {
    const bytes = payload.slice(3 + i * width, 3 + (i + 1) * width);
    if (pid === 0x06) values.push(bytes.map(hex).join(""));
    else {
      if (bytes.some((byte) => byte !== 0 && (byte < 0x20 || byte > 0x7e)))
        fail("Identificação contém caracteres inválidos.", "MALFORMED");
      const value = String.fromCharCode(...bytes)
        .replace(/\0+$/g, "")
        .trim();
      if (!value || (pid === 0x02 && !/^[A-HJ-NPR-Z0-9]{17}$/.test(value)))
        fail("VIN ou identificação ASCII inválida.", "MALFORMED");
      values.push(value);
    }
  }
  return values;
}

/** Uma sessão sempre representa operação real. Não há fallback para dados de demonstração. */
export class ElmSession {
  constructor(
    transport,
    { ecuId = null, clock = () => performance.now() } = {},
  ) {
    if (
      !transport ||
      typeof transport.request !== "function" ||
      typeof transport.close !== "function"
    )
      throw new TypeError("Transporte ELM327 inválido.");
    if (ecuId !== null && !/^[0-7][0-9A-F]{2}$/i.test(ecuId))
      throw new TypeError("CAN ID inválido (11 bits).");
    this.transport = transport;
    this.ecuId = ecuId?.toUpperCase() || null;
    this.sourceMode = "real";
    this.responders = [];
    this.protocol = null;
    this.adapter = null;
    this.initialized = false;
    this.closed = false;
    this._pids = null;
    this._clock = clock;
    this._start = clock();
    this._queue = Promise.resolve();
  }
  _serialized(operation) {
    const result = this._queue.then(() => {
      if (this.closed)
        fail("Sessão desconectada. Conecte novamente.", "DISCONNECTED");
      return operation();
    });
    this._queue = result.catch(() => {});
    return result;
  }
  async _request(command) {
    const normalized = assertReadOnlyCommand(command);
    return this.transport.request(normalized, {
      timeoutMs: normalized === "0100" ? 15000 : 8000,
    });
  }
  async _obd(command) {
    const response = parseElmResponse(await this._request(command), {
      request: command,
      ecuId: this.ecuId,
    });
    this.ecuId = response.ecuId;
    this.responders = [
      ...new Set([...this.responders, ...response.responders]),
    ];
    return response.payload;
  }
  _requireReady() {
    if (!this.initialized)
      fail("Inicialize o adaptador antes das consultas.", "NOT_INITIALIZED");
  }
  initialize() {
    return this._serialized(async () => {
      this.initialized = false;
      this._pids = null;
      const reset = await this._request("ATZ");
      if (!/ELM327/i.test(reset) || !reset.includes(">"))
        fail(
          "O adaptador não se identificou como ELM327. Use integração documentada para outros scanners.",
          "UNSUPPORTED_ADAPTER",
        );
      for (const command of [
        "ATE0",
        "ATL0",
        "ATS1",
        "ATH1",
        "ATCAF1",
        "ATCFC1",
        "ATSP0",
      ]) {
        const lines = responseLines(await this._request(command), command);
        if (lines.length !== 1 || lines[0].toUpperCase() !== "OK")
          fail(`O adaptador não aceitou ${command}.`, "ADAPTER_CONFIGURATION");
      }
      this.adapter = responseLines(await this._request("ATI"), "ATI").join(" ");
      // A consulta inicial faz a busca automática no adaptador; só CAN 11 bits é decodificado.
      const initial = await this._obd("0100");
      const protocol = responseLines(await this._request("ATDPN"), "ATDPN")
        .join("")
        .toUpperCase();
      if (!/^A?[68]$/.test(protocol))
        fail(
          "O perfil atual suporta somente ISO 15765-4 CAN de 11 bits (protocolos ELM 6 ou 8).",
          "UNSUPPORTED_PROTOCOL",
        );
      this.protocol = protocol;
      this._pids = new Set(supportMask(initial, 0));
      if (this._pids.has(0x20))
        supportMask(await this._obd("0120"), 0x20).forEach((pid) =>
          this._pids.add(pid),
        );
      if (this._pids.has(0x40))
        supportMask(await this._obd("0140"), 0x40).forEach((pid) =>
          this._pids.add(pid),
        );
      this.initialized = true;
      this._start = this._clock();
      return {
        adapter: this.adapter,
        protocol: this.protocol,
        ecuId: this.ecuId,
        responders: [...this.responders],
        sourceMode: "real",
      };
    });
  }
  supportedPids() {
    return this._serialized(async () => {
      this._requireReady();
      return {
        ecuId: this.ecuId,
        responders: [...this.responders],
        pids: [...this._pids].sort((a, b) => a - b).map(hex),
        supports: {
          rpm: this._pids.has(0x0c),
          throttle: this._pids.has(0x11),
          pedal: this._pids.has(0x49),
        },
      };
    });
  }
  identify() {
    return this._serialized(async () => {
      this._requireReady();
      const result = {
        ecuId: this.ecuId,
        vin: null,
        calibrationIds: [],
        cvns: [],
        source: "OBD-II serviço 09 · ECU CAN " + this.ecuId,
        errors: [],
      };
      let supported;
      try {
        supported = supportMask(await this._obd("0900"), 0);
      } catch (error) {
        result.errors.push({
          request: "0900",
          message: error.message,
          code: error.code,
        });
        return result;
      }
      for (const [pid, property] of [
        [0x02, "vin"],
        [0x04, "calibrationIds"],
        [0x06, "cvns"],
      ]) {
        if (!supported.includes(pid)) continue;
        const request = "09" + hex(pid);
        try {
          const values = identificationValues(await this._obd(request), pid);
          result[property] = pid === 0x02 ? values[0] : values;
        } catch (error) {
          result.errors.push({
            request,
            message: error.message,
            code: error.code,
          });
        }
      }
      return result;
    });
  }
  readDtc() {
    return this._serialized(async () => {
      this._requireReady();
      const result = {
        ecuId: this.ecuId,
        codes: [],
        complete: true,
        errors: [],
      };
      for (const [request, status] of [
        ["03", "Armazenado"],
        ["07", "Pendente"],
        ["0A", "Permanente"],
      ]) {
        try {
          const codes = decodeDtc(
            await this._obd(request),
            parseInt(request, 16),
          );
          result.codes.push(
            ...codes.map((code) => ({
              code,
              description:
                "Código OBD-II informado pela ECU; consulte a documentação do fabricante.",
              status,
              ecuId: this.ecuId,
            })),
          );
        } catch (error) {
          result.complete = false;
          result.errors.push({
            request,
            status,
            message: error.message,
            code: error.code,
          });
        }
      }
      return result;
    });
  }
  readSignals() {
    return this._serialized(async () => {
      this._requireReady();
      const result = {
        time_s: 0,
        pedal_pct: null,
        throttle_pct: null,
        rpm: null,
        ecuId: this.ecuId,
        sourceMode: "real",
        channels: {},
        errors: [],
      };
      for (const [pid, key, width, convert] of [
        [0x0c, "rpm", 2, (bytes) => (bytes[0] * 256 + bytes[1]) / 4],
        [0x11, "throttle_pct", 1, (bytes) => (bytes[0] * 100) / 255],
        [0x49, "pedal_pct", 1, (bytes) => (bytes[0] * 100) / 255],
      ]) {
        if (!this._pids.has(pid)) {
          result.channels[key] = {
            pid: hex(pid),
            supported: false,
            ecuId: this.ecuId,
          };
          continue;
        }
        const request = "01" + hex(pid),
          started = this._clock();
        try {
          const payload = await this._obd(request);
          if (payload.length !== 2 + width)
            fail(`Resposta ${request} incompleta ou inválida.`, "MALFORMED");
          result[key] = convert(payload.slice(2));
          result.channels[key] = {
            pid: hex(pid),
            supported: true,
            ecuId: this.ecuId,
            observed_at_s: (this._clock() - this._start) / 1000,
            acquisition_s: (this._clock() - started) / 1000,
          };
        } catch (error) {
          result.errors.push({
            request,
            channel: key,
            message: error.message,
            code: error.code,
          });
          result.channels[key] = {
            pid: hex(pid),
            supported: true,
            valid: false,
            ecuId: this.ecuId,
          };
        }
      }
      result.time_s = (this._clock() - this._start) / 1000;
      return result;
    });
  }
  async close() {
    this.closed = true;
    this.initialized = false;
    await this.transport.close();
  }
}
