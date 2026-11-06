import { ElmSession } from "./obd.mjs";
import {
  WebSerialTransport,
  BleTransport,
  getCapabilities,
} from "./transports.mjs";
import { SCANNERS, CONNECTION_MATRIX } from "./catalog.mjs";
import { completeRealSamples } from "./modes.mjs";
import { escapeHtml as h } from "./report.mjs";
import { csvEncode } from "./core.mjs";
import { APP_VERSION } from "./modules.mjs";

const shown = (v, unit = "") =>
  v == null
    ? "Não disponível"
    : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${unit}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_FRAMES = 1000;
const CAPTURE_SOURCE = "ELM327 · leitura OBD-II genérica";
const SIGNAL_DEFINITIONS = Object.freeze({
  time_s: "monotonic_seconds",
  pedal_pct: "OBD-II 01 49 percent",
  throttle_pct: "OBD-II 01 11 percent",
  rpm: "OBD-II 01 0C rpm",
});

function captureProvenance(connection) {
  if (!connection) return null;
  return {
    schema_version: 1,
    kind: "scanner_capture",
    source: CAPTURE_SOURCE,
    captured_at: connection.started_at_utc,
    verification: "protocol_capture",
    reference: connection.capture_id,
  };
}

/** Operação real fica isolada do gerador fictício e do simulador matemático. */
export function createConnectionController({
  notify,
  onSave,
  download,
  canOperate = () => true,
  onSafetyChange = () => {},
}) {
  let session = null,
    transport = null,
    scope = null,
    host = null;
  let phase = "disconnected",
    busy = false,
    collecting = false,
    vehicleId = "",
    connection = null;
  let frames = [],
    identity = null,
    dtc = null,
    diagnosticError = "",
    lastError = "";
  let epoch = 0;
  let savedFrames = 0,
    savedIdentity = null,
    savedDtc = null;

  const capabilities = () => getCapabilities();
  const hasUnsavedData = () =>
    frames.length > savedFrames ||
    (!!identity && identity !== savedIdentity) ||
    (!!dtc && dtc !== savedDtc);
  function paint() {
    onSafetyChange();
    if (!host?.isConnected) return;
    const status = host.querySelector("#live-status");
    if (!status) return;
    status.textContent = {
      disconnected: "Desconectado",
      connecting: "Conectando ao adaptador…",
      connected: "Conectado · consultas de leitura",
      error: "Sessão interrompida",
    }[phase];
    status.dataset.phase = phase;
    host.querySelector("#live-error").textContent = lastError;
    host.querySelector("#live-count").textContent = String(frames.length);
    const last = frames.at(-1);
    for (const [key, unit] of [
      ["pedal_pct", "%"],
      ["throttle_pct", "%"],
      ["rpm", "RPM"],
    ])
      host.querySelector(`[data-live-signal="${key}"]`).textContent = shown(
        last?.[key],
        unit,
      );
    host.querySelector("#live-identification").textContent = identity
      ? `ECU CAN ${identity.ecuId || "—"} · VIN ${identity.vin || "não informado"} · Calibração ${identity.calibrationIds?.join(", ") || "não informada"}`
      : "Identificação ainda não consultada. Não inferimos fabricante ou família da ECU pelo veículo.";
    const dtcText =
      diagnosticError ||
      (dtc
        ? !dtc.complete
          ? "Consulta incompleta; não é possível concluir ausência de DTCs. " +
            (dtc.errors || [])
              .map((error) => error.message || String(error))
              .join(" · ")
          : dtc.codes?.length
            ? dtc.codes.map((c) => `${c.code} · ${c.status}`).join(" | ")
            : "Nenhum DTC nos serviços consultados."
        : "DTCs ainda não consultados.");
    host.querySelector("#live-dtc").textContent = dtcText;
    const selected = !!session && phase === "connected";
    for (const button of host.querySelectorAll("[data-live-action]")) {
      const action = button.dataset.liveAction;
      button.disabled =
        action === "stop"
          ? !collecting
          : action === "disconnect"
            ? !session && phase !== "connecting"
            : action === "export"
              ? !frames.length && !identity && !dtc
              : action === "discard"
                ? busy || collecting || (!frames.length && !identity && !dtc)
                : action === "save"
                  ? busy || collecting || frames.length < 2
                  : !selected || busy || collecting;
    }
    const connectButton = host.querySelector(
      '#connect-form button[type="submit"]',
    );
    const caps = capabilities();
    if (connectButton)
      connectButton.disabled =
        phase === "connecting" ||
        !!session ||
        busy ||
        (!caps.serial && !caps.ble);
    host.querySelector("#live-collection-state").textContent = collecting
      ? "Coleta ativa. Os canais são consultados em sequência; mantenha esta tela aberta."
      : `Coleta parada · ${frames.length} amostra(s). Canais ausentes permanecem vazios.`;
  }
  async function closeConnection() {
    collecting = false;
    epoch++;
    const old = session,
      oldTransport = transport;
    session = null;
    transport = null;
    phase = "disconnected";
    paint();
    if (old) await old.close();
    else if (oldTransport) await oldTransport.close();
  }
  async function run(operation) {
    if (busy || collecting)
      throw new Error("Aguarde a consulta em andamento ou pare a coleta.");
    if (!session || phase !== "connected")
      throw new Error("Conecte um adaptador ELM327 documentado.");
    busy = true;
    lastError = "";
    paint();
    try {
      return await operation();
    } catch (error) {
      lastError = error.message;
      throw error;
    } finally {
      busy = false;
      paint();
    }
  }
  async function sampleOnce(expectedEpoch = epoch) {
    const frame = await session.readSignals();
    if (expectedEpoch !== epoch) return;
    if (frames.length && frame.time_s <= frames.at(-1).time_s)
      throw new Error(
        "Tempo de aquisição não avançou. Pare e confira o adaptador.",
      );
    frames.push(frame);
    paint();
  }
  async function collect() {
    if (!session || busy || collecting)
      throw new Error("Conecte e aguarde a conclusão das consultas.");
    collecting = true;
    busy = true;
    const myEpoch = epoch;
    paint();
    try {
      while (collecting && myEpoch === epoch && frames.length < MAX_FRAMES) {
        if (!transport?.isConnected)
          throw new Error(
            "O adaptador foi desconectado. A coleta foi interrompida.",
          );
        await sampleOnce(myEpoch);
        if (collecting) await pause(500);
      }
      if (frames.length >= MAX_FRAMES)
        notify(
          "Limite de 1.000 amostras por sessão atingido. Exporte ou salve a coleta.",
        );
    } catch (error) {
      lastError = error.message;
      phase = "error";
      notify(error.message, true);
    } finally {
      collecting = false;
      busy = false;
      paint();
    }
  }
  function rawReport() {
    return {
      application: "AUTO ECU LAB — Auto Elétrica Doidinho",
      version: APP_VERSION,
      operation_mode: "real",
      generated_at_utc: new Date().toISOString(),
      vehicle_id: vehicleId,
      capture_id: connection?.capture_id ?? null,
      provenance: captureProvenance(connection),
      signal_definitions: { ...SIGNAL_DEFINITIONS },
      connection,
      identity,
      diagnostics: dtc,
      diagnostic_error: diagnosticError || null,
      frames: structuredClone(frames),
      limitations:
        "Consultas OBD-II genéricas em leitura. Suporte depende dos PIDs, protocolo e adaptador. Canais consultados sequencialmente, sem interpolação nem preenchimento de ausências. Não grava na ECU, não apaga códigos nem executa atuadores.",
    };
  }
  async function connect(form, vehicles) {
    if (!canOperate())
      throw new Error(
        "Atualização sendo preparada. Aguarde antes de conectar.",
      );
    if (session || phase === "connecting" || busy)
      throw new Error(
        "Desconecte o adaptador atual e aguarde as consultas antes de iniciar outra sessão.",
      );
    if (
      hasUnsavedData() &&
      !confirm(
        "Uma nova conexão iniciará outra coleta. Exporte ou salve as amostras atuais antes de continuar. Deseja iniciar?",
      )
    )
      return;
    const data = new FormData(form),
      selected = vehicles.find((v) => v.id === data.get("vehicleId"));
    if (!selected) throw new Error("Cadastre e selecione um veículo.");
    if (data.get("realAcknowledged") !== "on")
      throw new Error(
        "Confirme que deseja iniciar consultas reais ao adaptador selecionado.",
      );
    const type = data.get("connectionType");
    if (!["serial", "ble"].includes(type))
      throw new Error(
        "Este transporte requer o componente Python ou uma integração nativa autorizada.",
      );
    const opts = {
      baudRate: Number(data.get("baudRate")),
      serviceUuid: String(data.get("serviceUuid") || "").trim(),
      writeUuid: String(data.get("writeUuid") || "").trim(),
      notifyUuid: String(data.get("notifyUuid") || "").trim(),
    };
    phase = "connecting";
    busy = true;
    lastError = "";
    paint();
    const myEpoch = ++epoch;
    try {
      const opened =
        type === "serial"
          ? await WebSerialTransport.connect({ baudRate: opts.baudRate })
          : await BleTransport.connect(opts);
      if (myEpoch !== epoch) {
        await opened.close();
        return;
      }
      transport = opened;
      transport.onDisconnect = (reason) => {
        if (myEpoch !== epoch) return;
        collecting = false;
        phase = "error";
        lastError = reason?.message || "O adaptador foi desconectado.";
        session = null;
        transport = null;
        epoch++;
        paint();
        notify(lastError, true);
      };
      session = new ElmSession(transport, {
        ecuId: String(data.get("ecuId") || "").trim() || undefined,
      });
      const adapter = await session.initialize();
      if (myEpoch !== epoch) return;
      frames = [];
      savedFrames = 0;
      savedIdentity = null;
      savedDtc = null;
      identity = null;
      dtc = null;
      diagnosticError = "";
      vehicleId = selected.id;
      connection = {
        type,
        adapter,
        capture_id: crypto.randomUUID(),
        transport_name: transport.name || type,
        started_at_utc: new Date().toISOString(),
      };
      phase = "connected";
      notify(
        "Adaptador conectado. Use os botões para consultar identificação, DTCs ou sinais.",
      );
    } catch (error) {
      if (myEpoch === epoch) {
        lastError = error.message;
        await closeConnection().catch(() => {});
        phase = "error";
      }
      throw error;
    } finally {
      busy = false;
      paint();
    }
  }
  function page(vehicles, selectedVehicleId = "") {
    const caps = capabilities();
    return `<div class="page-heading"><div><span class="eyebrow">OPERAÇÃO REAL · SOMENTE LEITURA</span><h1>Conexões e scanners</h1><p>ELM327 documentado para consultas OBD-II genéricas. Simulações ficam em uma área separada.</p></div><span class="badge">SEM GRAVAÇÃO NA ECU</span></div><div class="two-col"><section class="panel"><div class="panel-heading"><div><h2>Conectar adaptador</h2><p>A conexão só começa após sua escolha e a permissão do navegador.</p></div></div><form id="connect-form" class="padded-form"><label>Veículo<select name="vehicleId" required>${vehicles.map((v) => `<option value="${h(v.id)}" ${v.id === (vehicleId || selectedVehicleId) ? "selected" : ""}>${h(v.brand)} ${h(v.model)} ${v.year} · ${h(v.engine)}</option>`).join("")}</select></label><label>Scanner<select name="scanner"><option>ELM327 · comandos documentados</option></select></label><label>Conexão<select name="connectionType"><option value="serial" ${caps.serial ? "" : "disabled"}>USB / Bluetooth Classic · serial ${caps.serial ? "" : "(API indisponível)"}</option><option value="ble" ${caps.ble ? "" : "disabled"}>Bluetooth BLE · GATT ${caps.ble ? "" : "(API indisponível)"}</option></select></label><div class="form-grid"><label>Velocidade serial<select name="baudRate"><option>38400</option><option>115200</option><option>9600</option></select></label><label>ECU CAN de resposta (opcional)<input name="ecuId" placeholder="Ex.: 7E8, conforme aquisição" maxlength="3"><small>Sem seleção, é exigida uma única ECU respondente.</small></label></div><details class="mapping"><summary>Perfil BLE do fabricante</summary><p>Informe os UUIDs publicados pelo fabricante do adaptador. O ELM327 não define um perfil BLE universal.</p><label>Serviço GATT<input name="serviceUuid" placeholder="UUID do serviço" autocomplete="off"></label><label>Característica de envio<input name="writeUuid" placeholder="UUID de escrita no adaptador" autocomplete="off"></label><label>Característica de resposta<input name="notifyUuid" placeholder="UUID de notificações" autocomplete="off"></label></details><label class="checkbox-label"><input type="checkbox" name="realAcknowledged" required>Iniciar consultas reais de leitura no adaptador que eu selecionar. Nenhuma simulação será enviada ao veículo.</label><button class="btn primary" type="submit" ${!caps.serial && !caps.ble ? "disabled" : ""}>Escolher adaptador e conectar</button>${!caps.serial && !caps.ble ? '<p class="notice">Este navegador não oferece BLE/serial direto. No iOS, utilize análise CSV e uma integração nativa autorizada para acesso ao hardware. O componente Python atende as conexões documentadas no Windows.</p>' : ""}</form></section><section class="panel live-panel"><div class="panel-heading"><div><h2>Monitor de diagnóstico</h2><p id="live-status" role="status"></p></div><span class="badge">LEITURA REAL</span></div><div class="live-content"><p id="live-error" class="live-error" role="status"></p><div class="live-metrics"><div><small>Pedal</small><strong data-live-signal="pedal_pct">Não disponível</strong></div><div><small>Borboleta</small><strong data-live-signal="throttle_pct">Não disponível</strong></div><div><small>Rotação</small><strong data-live-signal="rpm">Não disponível</strong></div></div><p id="live-identification" class="notice"></p><p id="live-dtc" class="notice"></p><div class="live-actions"><button type="button" class="btn" data-live-action="identify">Identificar ECU</button><button type="button" class="btn" data-live-action="dtc">Consultar DTCs</button><button type="button" class="btn" data-live-action="sample">Ler uma amostra</button><button type="button" class="btn primary" data-live-action="start">Iniciar coleta</button><button type="button" class="btn" data-live-action="stop">Parar coleta</button><button type="button" class="btn" data-live-action="disconnect">Desconectar</button></div><p id="live-collection-state" class="notice"></p><p class="notice">Amostras desta sessão: <b id="live-count">0</b>. Ausência de PID é mostrada como indisponível, nunca como zero.</p><div class="live-actions"><button type="button" class="btn" data-live-action="export">Exportar registro real JSON</button><button type="button" class="btn primary" data-live-action="save">Salvar coleta para análise</button><button type="button" class="btn subtle" data-live-action="discard">Descartar sessão não salva</button></div><p class="notice">A análise do pedal exige todos os três sinais e pelo menos duas amostras. Registros parciais permanecem exportáveis, com erros e origem.</p></div></section></div><section class="panel"><div class="panel-heading"><div><h2>Scanners e integrações</h2><p>Um catálogo de veículos não comprova cobertura de uma ECU ou função.</p></div></div><div class="scanner-grid">${SCANNERS.map((s) => `<article class="scanner-card"><h3>${h(s.name)}</h3><span class="badge">${h(s.status)}</span><p>${h(s.description)}</p></article>`).join("")}</div></section><section class="panel compatibility-panel"><div class="panel-heading"><div><h2>Compatibilidade por plataforma</h2><p>A detecção do navegador e a documentação do adaptador determinam a conexão.</p></div></div><div class="table-wrap"><table><thead><tr><th>Plataforma</th><th>Conexão</th><th>Disponibilidade</th><th>Condições</th></tr></thead><tbody>${CONNECTION_MATRIX.map((row) => `<tr><td>${h(row.platform)}</td><td>${h(row.connection)}</td><td>${h(row.status)}</td><td class="wrappable-cell">${h(row.description)}</td></tr>`).join("")}</tbody></table></div></section><section class="panel backup-panel"><div><h2>Windows · USB, Classic, Wi-Fi e BLE</h2><p>O componente Python usa porta serial (USB/Classic), TCP para ELM327 Wi-Fi e BLE com UUIDs documentados. J2534 exige driver/SDK; Rasther III/S e outros scanners exigem integração autorizada. Não existe ponte de hardware instalada automaticamente pelo site.</p></div><a class="btn" href="./downloads/AUTO_ECU_LAB_Python.zip" download>Baixar componente Python</a></section>`;
  }
  function bind(element, vehicles) {
    scope?.abort();
    scope = new AbortController();
    host = element;
    const signal = scope.signal;
    host.querySelector("#connect-form")?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        connect(event.target, vehicles).catch((error) =>
          notify(error.message, true),
        );
      },
      { signal },
    );
    host.addEventListener(
      "click",
      async (event) => {
        const button = event.target.closest("[data-live-action]");
        if (!button) return;
        try {
          if (
            !["stop", "disconnect", "export", "discard"].includes(
              button.dataset.liveAction,
            ) &&
            !canOperate()
          )
            throw new Error(
              "Aguarde a atualização antes de iniciar outra operação.",
            );
          switch (button.dataset.liveAction) {
            case "identify":
              await run(async () => {
                identity = await session.identify();
              });
              break;
            case "dtc":
              await run(async () => {
                try {
                  dtc = await session.readDtc();
                  diagnosticError = "";
                } catch (error) {
                  diagnosticError = error.message;
                  throw error;
                }
              });
              break;
            case "sample":
              await run(() => sampleOnce());
              break;
            case "start":
              await collect();
              break;
            case "stop":
              collecting = false;
              paint();
              break;
            case "disconnect":
              await closeConnection();
              break;
            case "export":
              download(
                JSON.stringify(rawReport(), null, 2),
                "auto_ecu_lab_operacao_real.json",
                "application/json",
              );
              break;
            case "save": {
              if (busy || collecting)
                throw new Error(
                  "Pare a coleta e aguarde a consulta antes de salvar.",
                );
              const samples = completeRealSamples(frames);
              const metadata = {
                operation_mode: "real",
                source: CAPTURE_SOURCE,
                capture_id: connection?.capture_id ?? null,
                provenance: captureProvenance(connection),
                signal_definitions: { ...SIGNAL_DEFINITIONS },
                connection: structuredClone(connection),
                identity: structuredClone(identity),
                diagnostic_result: structuredClone(dtc),
                diagnostic_error: diagnosticError || null,
                channel_timestamps: frames.map((f) => ({
                  time_s: f.time_s,
                  channels: f.channels || {},
                  ecuId: f.ecuId,
                  errors: f.errors || [],
                })),
              };
              busy = true;
              paint();
              try {
                await onSave({
                  vehicleId,
                  samples,
                  diagnostics: dtc?.codes || [],
                  metadata,
                  title: "Coleta real · ELM327",
                });
                savedFrames = frames.length;
                savedIdentity = identity;
                savedDtc = dtc;
              } finally {
                busy = false;
                paint();
              }
              break;
            }
            case "discard": {
              if (busy || collecting)
                throw new Error(
                  "Pare a coleta e aguarde as consultas antes de descartar.",
                );
              if (
                !confirm(
                  "Descartar os dados não salvos desta sessão real? Leituras já salvas nos ensaios serão mantidas.",
                )
              )
                break;
              await closeConnection();
              frames = [];
              identity = null;
              dtc = null;
              diagnosticError = "";
              savedFrames = 0;
              savedIdentity = null;
              savedDtc = null;
              paint();
              break;
            }
          }
        } catch (error) {
          notify(error.message, true);
          paint();
        }
      },
      { signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden && collecting) {
          collecting = false;
          paint();
        }
      },
      { signal },
    );
    paint();
  }
  async function leave() {
    scope?.abort();
    scope = null;
    host = null;
    await closeConnection().catch(() => {});
  }
  return {
    page,
    bind,
    leave,
    get hasSession() {
      return !!session || phase === "connecting";
    },
    get isCollecting() {
      return collecting;
    },
    get isBusy() {
      return busy;
    },
    get hasUnsavedData() {
      return hasUnsavedData();
    },
  };
}
