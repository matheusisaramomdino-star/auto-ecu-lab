/** Transportes ELM327 acionados somente por gesto explícito do usuário. */
import { assertReadOnlyCommand, ObdError } from "./obd.mjs";

export const PLATFORM_CAPABILITIES = Object.freeze({
  windows: {
    ble: "Web Bluetooth quando disponível",
    classic: "RFCOMM/porta serial exposta pelo sistema",
    usb: "Porta serial USB com driver",
    wifi: "Exige transporte nativo/ponte local",
  },
  android: {
    ble: "Web Bluetooth quando disponível",
    classic: "Depende de suporte RFCOMM do navegador",
    usb: "Depende de API serial e acesso ao dispositivo",
    wifi: "Exige aplicativo nativo/ponte local",
  },
  ios: {
    ble: "Nativo/SDK quando Web Bluetooth não estiver disponível",
    classic: "Somente acessórios e SDKs autorizados quando suportados",
    usb: "Aplicativo/SDK nativo compatível",
    wifi: "Aplicativo/SDK nativo compatível",
  },
});

export function getCapabilities({
  navigator = globalThis.navigator,
  userAgent = navigator?.userAgent || "",
} = {}) {
  const platform =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && navigator?.maxTouchPoints > 1)
      ? "ios"
      : /Android/i.test(userAgent)
        ? "android"
        : /Windows/i.test(userAgent)
          ? "windows"
          : "other";
  const serial = typeof navigator?.serial?.requestPort === "function";
  const ble = typeof navigator?.bluetooth?.requestDevice === "function";
  const usbApi = typeof navigator?.usb?.requestDevice === "function";
  return {
    platform,
    ble,
    serial,
    usb: usbApi,
    usbSerial: serial,
    classicViaSerial: serial,
    bluetoothClassic: serial,
    wifi: false,
    secureContext: globalThis.isSecureContext !== false,
    notes: PLATFORM_CAPABILITIES[platform] || {},
  };
}

function checkSecure() {
  if (globalThis.isSecureContext === false)
    throw new Error("Conexões de hardware exigem HTTPS ou localhost.");
}
const connectionError = (message) => new ObdError(message, "DISCONNECTED");

class PromptTransport {
  constructor({ timeoutMs = 8000, type, name } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
      throw new Error("Timeout deve estar entre 100 e 60.000 ms.");
    this.timeoutMs = timeoutMs;
    this.type = type;
    this.name = name;
    this.isConnected = true;
    this._pending = null;
    this._queue = Promise.resolve();
    this._closing = null;
    this.onDisconnect = null;
  }
  request(command, { timeoutMs = this.timeoutMs } = {}) {
    const normalized = assertReadOnlyCommand(command);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
      return Promise.reject(new Error("Timeout inválido."));
    const result = this._queue.then(() =>
      this._exchange(normalized, timeoutMs),
    );
    this._queue = result.catch(() => {});
    return result;
  }
  _exchange(command, timeoutMs) {
    if (!this.isConnected)
      return Promise.reject(
        connectionError("Adaptador desconectado. Conecte novamente."),
      );
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new ObdError(
          "Tempo de resposta esgotado. A conexão foi encerrada para não reutilizar uma resposta atrasada.",
          "TIMEOUT",
        );
        this.close(error).catch(() => {});
      }, timeoutMs);
      this._pending = { resolve, reject, timeout, buffer: "" };
      Promise.resolve()
        .then(() => this._write(new TextEncoder().encode(command + "\r")))
        .catch((error) =>
          this.close(
            connectionError("Falha ao enviar a consulta: " + error.message),
          ).catch(() => {}),
        );
    });
  }
  _receive(bytes) {
    if (!this._pending || !this.isConnected) return;
    const text =
      typeof bytes === "string"
        ? bytes
        : new TextDecoder("ascii").decode(bytes);
    this._pending.buffer += text;
    if (this._pending.buffer.length > 131072) {
      this.close(
        new ObdError(
          "Resposta do adaptador excede o limite de segurança.",
          "RESPONSE_TOO_LARGE",
        ),
      ).catch(() => {});
      return;
    }
    const position = this._pending.buffer.indexOf(">");
    if (position < 0) return;
    const pending = this._pending;
    if (pending.buffer.slice(position + 1).trim()) {
      this.close(
        new ObdError(
          "O adaptador enviou mais de uma resposta inesperada.",
          "DESYNCHRONIZED",
        ),
      ).catch(() => {});
      return;
    }
    this._pending = null;
    clearTimeout(pending.timeout);
    pending.resolve(pending.buffer.slice(0, position + 1));
  }
  close(reason = connectionError("Conexão encerrada.")) {
    if (this._closing) return this._closing;
    this.isConnected = false;
    if (this._pending) {
      clearTimeout(this._pending.timeout);
      this._pending.reject(reason);
      this._pending = null;
    }
    this._closing = Promise.resolve()
      .then(() => this._dispose())
      .finally(() => {
        if (typeof this.onDisconnect === "function") this.onDisconnect(reason);
      });
    return this._closing;
  }
}

export class WebSerialTransport extends PromptTransport {
  static async connect({
    baudRate = 38400,
    timeoutMs = 8000,
    navigator = globalThis.navigator,
  } = {}) {
    checkSecure();
    if (!navigator?.serial?.requestPort)
      throw new Error(
        "Web Serial indisponível neste navegador. Use o aplicativo/ponte nativa compatível.",
      );
    if (!Number.isInteger(baudRate) || baudRate < 1200 || baudRate > 1000000)
      throw new Error(
        "Velocidade serial inválida; consulte a documentação do adaptador.",
      );
    const port = await navigator.serial.requestPort();
    try {
      await port.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });
      if (!port.readable || !port.writable)
        throw new Error("Porta sem leitura/escrita disponível.");
      return new WebSerialTransport(port, navigator.serial, { timeoutMs });
    } catch (error) {
      try {
        await port.close();
      } catch {}
      throw new Error(
        "Não foi possível abrir a porta serial: " + error.message,
      );
    }
  }
  constructor(port, serial, options) {
    super({
      ...options,
      type: "serial",
      name: "ELM327 · porta serial selecionada",
    });
    this.port = port;
    this.serial = serial;
    try {
      this.writer = port.writable.getWriter();
      this.reader = port.readable.getReader();
    } catch (error) {
      try {
        this.writer?.releaseLock();
      } catch {}
      throw error;
    }
    this._disconnect = (event) => {
      if (event.target === port || event.port === port)
        this.close(
          connectionError("O adaptador serial foi desconectado."),
        ).catch(() => {});
    };
    serial.addEventListener?.("disconnect", this._disconnect);
    this._reading = this._readLoop();
  }
  async _readLoop() {
    try {
      while (this.isConnected) {
        const { done, value } = await this.reader.read();
        if (done) {
          if (this.isConnected)
            this.close(
              connectionError("A leitura serial foi encerrada."),
            ).catch(() => {});
          break;
        }
        this._receive(value);
      }
    } catch (error) {
      if (this.isConnected)
        this.close(
          connectionError("Falha na leitura serial: " + error.message),
        ).catch(() => {});
    } finally {
      try {
        this.reader?.releaseLock();
      } catch {}
      this.reader = null;
    }
  }
  async _write(bytes) {
    if (!this.writer) throw connectionError("Porta serial encerrada.");
    await this.writer.write(bytes);
  }
  async _dispose() {
    this.serial.removeEventListener?.("disconnect", this._disconnect);
    try {
      await this.reader?.cancel();
    } catch {}
    try {
      await this._reading;
    } catch {}
    try {
      this.writer?.releaseLock();
    } catch {}
    this.writer = null;
    try {
      await this.port.close();
    } catch {}
  }
}

function uuid(value, label) {
  if (
    typeof value !== "string" ||
    !(
      /^[0-9a-f]{4}$/i.test(value) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
  )
    throw new Error(
      `${label}: informe o UUID documentado pelo fabricante do adaptador.`,
    );
  const normalized = value.toLowerCase();
  return normalized.length === 4
    ? `0000${normalized}-0000-1000-8000-00805f9b34fb`
    : normalized;
}

export class BleTransport extends PromptTransport {
  static async connect({
    serviceUuid,
    writeUuid,
    notifyUuid,
    timeoutMs = 8000,
    navigator = globalThis.navigator,
  } = {}) {
    checkSecure();
    if (!navigator?.bluetooth?.requestDevice)
      throw new Error(
        "Web Bluetooth indisponível neste navegador. No iOS, use uma integração nativa autorizada.",
      );
    const service = uuid(serviceUuid, "Serviço BLE"),
      write = uuid(writeUuid, "Característica de envio"),
      notify = uuid(notifyUuid, "Característica de recebimento");
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [service],
    });
    let receiver, transport;
    try {
      if (!device.gatt)
        throw new Error("Dispositivo sem servidor GATT disponível.");
      const server = await device.gatt.connect(),
        primary = await server.getPrimaryService(service);
      const sender = await primary.getCharacteristic(write);
      receiver = await primary.getCharacteristic(notify);
      if (!receiver.properties?.notify && !receiver.properties?.indicate)
        throw new Error("A característica informada não oferece notificações.");
      if (!sender.properties?.write && !sender.properties?.writeWithoutResponse)
        throw new Error("A característica informada não permite envio.");
      transport = new BleTransport(device, sender, receiver, { timeoutMs });
      await receiver.startNotifications();
      return transport;
    } catch (error) {
      if (transport) await transport.close().catch(() => {});
      else {
        try {
          await receiver?.stopNotifications();
        } catch {}
        device.gatt?.disconnect();
      }
      throw new Error(
        "Não foi possível conectar ao perfil BLE: " + error.message,
      );
    }
  }
  constructor(device, sender, receiver, options) {
    super({
      ...options,
      type: "ble",
      name: device.name || "ELM327 · BLE selecionado",
    });
    this.device = device;
    this.sender = sender;
    this.receiver = receiver;
    this._notification = (event) => {
      const value = event.target?.value;
      if (value)
        this._receive(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        );
    };
    this._disconnect = () =>
      this.close(connectionError("O adaptador BLE foi desconectado.")).catch(
        () => {},
      );
    receiver.addEventListener("characteristicvaluechanged", this._notification);
    device.addEventListener("gattserverdisconnected", this._disconnect);
  }
  async _write(bytes) {
    if (!this.device.gatt?.connected)
      throw connectionError("Dispositivo BLE desconectado.");
    if (this.sender.properties.write && this.sender.writeValueWithResponse)
      await this.sender.writeValueWithResponse(bytes);
    else if (this.sender.writeValueWithoutResponse)
      await this.sender.writeValueWithoutResponse(bytes);
    else if (this.sender.writeValue) await this.sender.writeValue(bytes);
    else throw new Error("Método de envio BLE não suportado.");
  }
  async _dispose() {
    this.receiver.removeEventListener(
      "characteristicvaluechanged",
      this._notification,
    );
    this.device.removeEventListener("gattserverdisconnected", this._disconnect);
    try {
      await this.receiver.stopNotifications();
    } catch {}
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
  }
}
