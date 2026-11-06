/* Atualizações do mesmo aplicativo instalado, sem acesso aos dados de diagnóstico. */
const CHECK_INTERVAL = 10 * 60 * 1000;
const LOCK_TIMEOUT = 12 * 1000;

/**
 * isSafe deve consultar o estado real da aplicação. onLock(true) deve bloquear
 * sincronamente o início de coletas, conexões, importações, edições e gravações
 * locais. beforeActivate pode concluir um checkpoint, mas nunca descartar dados.
 * Nenhum desses callbacks recebe ou envia comandos para um veículo.
 */
export function createUpdateManager(options = {}) {
  const nav = options.navigator ?? globalThis.navigator;
  const win = options.window ?? globalThis.window;
  const doc = options.document ?? globalThis.document;
  const timers = {
    interval: options.setInterval ?? globalThis.setInterval,
    clearInterval: options.clearInterval ?? globalThis.clearInterval,
    timeout: options.setTimeout ?? globalThis.setTimeout,
    clearTimeout: options.clearTimeout ?? globalThis.clearTimeout,
  };
  const request =
    options.fetch ??
    win?.fetch?.bind(win) ??
    globalThis.fetch?.bind(globalThis);
  const isSafe =
    options.isSafe ??
    (() => ({
      safe: false,
      reasons: ["A verificação de segurança da aplicação não está disponível."],
    }));
  const onState = options.onState ?? (() => {});
  const onLock = options.onLock ?? (() => {});
  const beforeActivate = options.beforeActivate ?? (async () => {});
  const reload = options.reload ?? (() => win?.location?.reload());
  let state = Object.freeze({
    status: "idle",
    message: "Atualizações serão verificadas ao abrir o aplicativo.",
    available: false,
    checking: false,
    locked: false,
    automatic: true,
    reasons: [],
    version: null,
    release: null,
    offlineReady: false,
    pendingReload: false,
  });
  let registration = null;
  let waitingWorker = null;
  let started = false;
  let destroyed = false;
  let startPromise = null;
  let checkPromise = null;
  let interval = null;
  let handshake = null;
  let attemptPending = false;
  let attemptTimer = null;
  let automaticRetry = true;
  let lastSafe = false;
  let hadController = Boolean(nav?.serviceWorker?.controller);
  let reloadStarted = false;
  let reloadPreparation = null;
  const cleanups = [];
  const watchedWorkers = new WeakSet();

  function publish(patch) {
    if (destroyed) return;
    state = Object.freeze({
      ...state,
      ...patch,
      reasons: [...(patch.reasons ?? state.reasons)],
    });
    try {
      onState(state);
    } catch {
      /* A interface não pode interromper o protocolo. */
    }
  }

  function safety() {
    try {
      const result = isSafe();
      const safe = result?.safe === true;
      const reasons = Array.isArray(result?.reasons)
        ? result.reasons
            .filter((reason) => typeof reason === "string" && reason.trim())
            .slice(0, 12)
        : [];
      return {
        safe,
        reasons: safe
          ? []
          : reasons.length
            ? reasons
            : ["Há uma operação ou alteração pendente nesta aba."],
      };
    } catch {
      return {
        safe: false,
        reasons: [
          "Não foi possível confirmar que as operações locais terminaram.",
        ],
      };
    }
  }

  function listen(target, type, listener) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener?.(type, listener));
  }

  function post(worker, message) {
    try {
      worker?.postMessage(message);
      return Boolean(worker);
    } catch {
      return false;
    }
  }

  function unlock() {
    if (!handshake) return;
    const previous = handshake;
    handshake = null;
    previous.cancelled = true;
    previous.finishPreparation?.(false);
    if (previous.timer !== null) timers.clearTimeout(previous.timer);
    if (previous.locked) {
      try {
        onLock(false);
      } catch {
        /* A liberação é tentada mesmo após uma falha da interface. */
      }
    }
    publish({ locked: false });
  }

  function blockHandshake(reasons) {
    if (!handshake) return;
    post(handshake.worker, {
      type: "UPDATE_BLOCKED",
      requestId: handshake.id,
      reasons,
    });
    unlock();
    attemptPending = false;
    automaticRetry = false;
    publish({
      status: "deferred",
      message: "Atualização aguardando um momento seguro.",
      reasons,
    });
  }

  async function prepare(event) {
    const data = event.data;
    const worker = event.source;
    if (
      !worker ||
      typeof data.requestId !== "string" ||
      data.requestId.length > 100
    )
      return;
    if (attemptTimer !== null) {
      timers.clearTimeout(attemptTimer);
      attemptTimer = null;
    }
    if (handshake) {
      if (handshake.id === data.requestId && handshake.ready) {
        post(worker, { type: "UPDATE_READY", requestId: data.requestId });
      } else if (handshake.id !== data.requestId) {
        post(worker, {
          type: "UPDATE_BLOCKED",
          requestId: data.requestId,
          reasons: ["Outra atualização já está em preparação nesta aba."],
        });
      }
      return;
    }
    const check = safety();
    lastSafe = check.safe;
    if (!check.safe || (data.mode === "automatic" && !state.automatic)) {
      const reasons = check.safe
        ? ["As atualizações automáticas estão desativadas nesta aba."]
        : check.reasons;
      post(worker, {
        type: "UPDATE_BLOCKED",
        requestId: data.requestId,
        reasons,
      });
      publish({
        status: "deferred",
        message: "Atualização aguardando um momento seguro.",
        reasons,
      });
      return;
    }
    const token = {
      id: data.requestId,
      worker,
      mode: data.mode,
      locked: false,
      ready: false,
      committed: false,
      cancelled: false,
      timer: null,
    };
    token.preparation = new Promise((resolve) => {
      token.finishPreparation = resolve;
    });
    handshake = token;
    try {
      // A trava vem antes de qualquer await: nenhuma nova operação pode começar.
      onLock(true);
      token.locked = true;
      publish({
        status: "preparing",
        message: "Preparando a atualização com as operações protegidas.",
        locked: true,
        reasons: [],
      });
      token.timer = timers.timeout(() => {
        if (handshake === token)
          blockHandshake([
            "A confirmação das outras abas demorou. A aplicação foi liberada para continuar.",
          ]);
      }, LOCK_TIMEOUT);
      await beforeActivate();
      if (destroyed || handshake !== token || token.cancelled) return;
      const afterSave = safety();
      if (!afterSave.safe) {
        blockHandshake(afterSave.reasons);
        return;
      }
      token.ready = true;
      token.finishPreparation(true);
      if (!post(worker, { type: "UPDATE_READY", requestId: token.id })) {
        blockHandshake([
          "Não foi possível confirmar a atualização com o aplicativo.",
        ]);
      }
    } catch {
      // onLock pode falhar depois de estabelecer parcialmente a trava.
      if (handshake === token) {
        token.locked = true;
        blockHandshake([
          "Não foi possível concluir a preparação dos dados locais. Tente novamente após salvar.",
        ]);
      }
    }
  }

  function finishReload() {
    // Controllerchange pode se repetir ou chegar durante o checkpoint de um
    // outro caminho. Todas as chamadas devem aguardar a mesma preparação.
    if (!reloadPreparation) {
      reloadPreparation = Promise.resolve()
        .then(performReload)
        .finally(() => {
          reloadPreparation = null;
        });
    }
    return reloadPreparation;
  }

  async function performReload() {
    if (destroyed || reloadStarted) return false;
    const check = safety();
    if (!check.safe) {
      unlock();
      attemptPending = false;
      publish({
        status: "deferred",
        message:
          "A nova versão está pronta. A reabertura aguarda o fim das operações locais.",
        pendingReload: true,
        reasons: check.reasons,
      });
      return false;
    }
    if (handshake?.locked && handshake.preparation) {
      const token = handshake;
      const prepared = await token.preparation;
      if (destroyed || !prepared || handshake !== token || token.cancelled)
        return false;
    }
    // Se o navegador trocou o controller após a expiração da trava, adquirir
    // outra trava e verificar os dados novamente antes de reabrir a interface.
    if (!handshake?.locked) {
      const token = {
        id: null,
        worker: null,
        locked: true,
        cancelled: false,
        timer: null,
      };
      handshake = token;
      try {
        onLock(true);
        publish({ locked: true });
        token.timer = timers.timeout(() => {
          if (handshake !== token) return;
          unlock();
          publish({
            status: "deferred",
            pendingReload: true,
            message:
              "A preparação demorou. A reabertura foi adiada para preservar os dados.",
            reasons: [
              "Conclua e salve as operações locais antes de tentar novamente.",
            ],
          });
        }, LOCK_TIMEOUT);
        await beforeActivate();
        if (destroyed || handshake !== token || token.cancelled) return false;
        const finalCheck = safety();
        if (!finalCheck.safe) {
          unlock();
          publish({
            status: "deferred",
            pendingReload: true,
            reasons: finalCheck.reasons,
            message: "A reabertura aguarda o fim das operações locais.",
          });
          return false;
        }
      } catch {
        unlock();
        publish({
          status: "deferred",
          pendingReload: true,
          reasons: ["Salve os dados locais antes de reabrir a nova versão."],
          message: "A reabertura foi adiada para preservar os dados.",
        });
        return false;
      }
    }
    if (destroyed) return false;
    const finalSafety = safety();
    if (!finalSafety.safe) {
      unlock();
      publish({
        status: "deferred",
        pendingReload: true,
        reasons: finalSafety.reasons,
        message: "A reabertura aguarda o fim das operações locais.",
      });
      return false;
    }
    reloadStarted = true;
    publish({
      status: "updating",
      message: "Abrindo a nova versão no mesmo aplicativo.",
      pendingReload: false,
      reasons: [],
    });
    try {
      reload();
      return true;
    } catch {
      reloadStarted = false;
      unlock();
      publish({
        status: "error",
        pendingReload: true,
        message: "A nova versão está pronta. Reabra o aplicativo quando puder.",
      });
      return false;
    }
  }

  function onMessage(event) {
    if (destroyed) return;
    const data = event.data ?? {};
    if (data.type === "OFFLINE_READY" || data.type === "OFFLINE_UNAVAILABLE") {
      publish({
        offlineReady: data.type === "OFFLINE_READY",
        version:
          typeof data.version === "string" ? data.version : state.version,
      });
    } else if (data.type === "UPDATE_PREPARE") {
      void prepare(event);
    } else if (
      data.type === "UPDATE_COMMIT" &&
      handshake?.id === data.requestId &&
      handshake.worker === event.source
    ) {
      handshake.committed = true;
      publish({
        status: "updating",
        message:
          "Atualização confirmada em todas as abas. Abrindo a nova versão.",
        reasons: [],
      });
    } else if (
      (data.type === "UPDATE_ABORT" || data.type === "UPDATE_DEFERRED") &&
      (!handshake || handshake.id === data.requestId)
    ) {
      if (handshake && handshake.worker !== event.source) return;
      unlock();
      if (attemptTimer !== null) {
        timers.clearTimeout(attemptTimer);
        attemptTimer = null;
      }
      attemptPending = false;
      automaticRetry = false;
      publish({
        status: "deferred",
        message: "Atualização adiada. Você pode continuar usando o aplicativo.",
        reasons: Array.isArray(data.reasons)
          ? data.reasons
              .filter((reason) => typeof reason === "string")
              .slice(0, 12)
          : ["Outra aba precisa concluir suas operações ou ser fechada."],
      });
    }
  }

  function queryOffline() {
    post(nav?.serviceWorker?.controller ?? registration?.active, {
      type: "CHECK_OFFLINE_READY",
    });
  }

  function detectWaiting() {
    const worker = registration?.waiting;
    if (worker) waitingWorker = worker;
    if (
      !waitingWorker ||
      waitingWorker.state === "redundant" ||
      waitingWorker.state === "activated"
    ) {
      waitingWorker = null;
      if (state.available && !handshake && !attemptPending)
        publish({ available: false });
      return;
    }
    if (!state.available) automaticRetry = true;
    publish({
      available: true,
      status: attemptPending ? state.status : "available",
      message: attemptPending
        ? state.message
        : "Uma nova versão está pronta para atualizar neste mesmo aplicativo.",
    });
  }

  function maybeAutomatic() {
    if (
      !destroyed &&
      state.automatic &&
      automaticRetry &&
      !attemptPending &&
      !handshake &&
      (state.available || state.pendingReload)
    ) {
      const check = safety();
      lastSafe = check.safe;
      if (check.safe) void apply("automatic");
      else
        publish({
          status: "deferred",
          message: "Atualização aguardando o fim das operações locais.",
          reasons: check.reasons,
        });
    }
  }

  function watchWorker(worker) {
    if (!worker || watchedWorkers.has(worker)) return;
    watchedWorkers.add(worker);
    listen(worker, "statechange", () => {
      if (
        worker.state === "installed" &&
        (hadController || nav?.serviceWorker?.controller)
      ) {
        waitingWorker = registration?.waiting ?? worker;
        automaticRetry = true;
        publish({
          available: true,
          status: "available",
          message:
            "Uma nova versão está pronta para atualizar neste mesmo aplicativo.",
        });
        maybeAutomatic();
      } else if (worker.state === "redundant") {
        if (waitingWorker === worker) waitingWorker = null;
        publish({
          checking: false,
          status: "error",
          message:
            "A atualização não foi preparada. A versão atual continua disponível.",
        });
      }
    });
  }

  async function readRelease() {
    if (!request) return;
    try {
      const response = await request("./release.json", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (
        !response.ok ||
        response.redirected ||
        !/json/i.test(response.headers?.get("Content-Type") ?? "")
      )
        return;
      const release = await response.json();
      if (
        release &&
        typeof release === "object" &&
        typeof release.version === "string" &&
        release.version.length < 60
      ) {
        publish({ release });
      }
    } catch {
      /* Sem internet, o shell já preparado continua funcionando. */
    }
  }

  async function check() {
    if (destroyed) return false;
    if (!registration) {
      await start();
      if (!registration || destroyed) return false;
    }
    if (checkPromise) return checkPromise;
    checkPromise = (async () => {
      automaticRetry = true;
      if (nav?.onLine === false) {
        detectWaiting();
        publish({
          checking: false,
          status: state.available ? "available" : "offline",
          message: state.available
            ? "Uma atualização já preparada está disponível neste aplicativo."
            : "Sem internet. A versão preparada continua disponível.",
        });
        queryOffline();
        maybeAutomatic();
        return false;
      }
      publish({
        checking: true,
        status: "checking",
        message: "Verificando atualizações do aplicativo.",
        reasons: [],
      });
      const results = await Promise.allSettled([
        registration.update(),
        readRelease(),
      ]);
      if (destroyed) return false;
      detectWaiting();
      queryOffline();
      const failed = results[0].status === "rejected";
      publish({
        checking: false,
        ...(!state.available && !state.locked && !state.pendingReload
          ? {
              status: failed ? "offline" : "current",
              message: failed
                ? "A verificação não conseguiu acessar a rede. A versão atual continua disponível."
                : "Você está usando a versão preparada mais recente.",
            }
          : {}),
      });
      maybeAutomatic();
      return !failed;
    })();
    try {
      return await checkPromise;
    } finally {
      checkPromise = null;
    }
  }

  async function apply(mode = "manual") {
    if (destroyed || attemptPending || handshake || reloadStarted) return false;
    const check = safety();
    lastSafe = check.safe;
    if (!check.safe) {
      publish({
        status: "deferred",
        message: "Atualização aguardando o fim das operações locais.",
        reasons: check.reasons,
      });
      return false;
    }
    if (state.pendingReload) return finishReload();
    detectWaiting();
    if (!waitingWorker) return false;
    attemptPending = true;
    automaticRetry = false;
    publish({
      status: "preparing",
      message: "Confirmando que todas as abas podem atualizar com segurança.",
      reasons: [],
    });
    if (
      !post(waitingWorker, {
        type: "ACTIVATE_WHEN_SAFE",
        mode: mode === "automatic" ? "automatic" : "manual",
      })
    ) {
      attemptPending = false;
      publish({
        status: "error",
        message:
          "Não foi possível iniciar a atualização. Tente verificar novamente.",
      });
      return false;
    }
    attemptTimer = timers.timeout(() => {
      attemptTimer = null;
      if (destroyed || handshake || !attemptPending) return;
      attemptPending = false;
      publish({
        status: "deferred",
        message:
          "A atualização não recebeu confirmação. Continue usando o aplicativo e tente novamente quando as outras abas estiverem fechadas.",
        reasons: ["Nenhuma operação foi interrompida."],
      });
    }, LOCK_TIMEOUT);
    return true;
  }

  function refreshSafety() {
    if (destroyed) return false;
    const check = safety();
    if (check.safe && !lastSafe) automaticRetry = true;
    lastSafe = check.safe;
    if (handshake && !check.safe) blockHandshake(check.reasons);
    else if (!check.safe && (state.available || state.pendingReload)) {
      publish({
        status: "deferred",
        message: "Atualização aguardando o fim das operações locais.",
        reasons: check.reasons,
      });
    } else maybeAutomatic();
    return check.safe;
  }

  function setAutomatic(value) {
    const automatic = value === true;
    publish({ automatic });
    if (!automatic && handshake?.mode === "automatic" && !handshake.committed) {
      blockHandshake([
        "As atualizações automáticas foram desativadas nesta aba.",
      ]);
    }
    if (automatic) {
      automaticRetry = true;
      maybeAutomatic();
    }
    return automatic;
  }

  async function start() {
    if (destroyed) return null;
    if (startPromise) return startPromise;
    if (registration) return registration;
    if (!nav?.serviceWorker?.register) {
      publish({
        status: "unsupported",
        message:
          "Este navegador não oferece atualização do aplicativo instalado. Use a versão web conectada.",
      });
      return null;
    }
    if (!started) {
      started = true;
      listen(nav.serviceWorker, "message", onMessage);
      listen(nav.serviceWorker, "controllerchange", () => {
        const replacing = hadController;
        hadController = Boolean(nav.serviceWorker.controller);
        queryOffline();
        if (!replacing) return; // Primeira instalação: não reiniciar a interface.
        waitingWorker = null;
        publish({ available: false, pendingReload: true });
        // Mudanças inesperadas de controller também passam pelos mesmos guards.
        if (handshake?.committed || state.automatic || attemptPending)
          void finishReload();
        else
          publish({
            status: "available",
            message:
              "A nova versão estará disponível ao reabrir o aplicativo com as operações concluídas.",
          });
      });
      listen(win, "focus", () => {
        refreshSafety();
        void check();
      });
      listen(win, "online", () => {
        void check();
      });
      listen(win, "offline", () => {
        publish({
          status: state.available ? state.status : "offline",
          message: state.available
            ? state.message
            : "Sem internet. A versão preparada continua disponível.",
        });
      });
      listen(doc, "visibilitychange", () => {
        if (doc.visibilityState === "visible") {
          refreshSafety();
          void check();
        }
      });
      interval = timers.interval(() => {
        void check();
      }, CHECK_INTERVAL);
    }
    startPromise = (async () => {
      try {
        const registered = await nav.serviceWorker.register("./sw.js", {
          scope: "./",
          updateViaCache: "none",
        });
        if (destroyed) return null;
        registration = registered;
        listen(registration, "updatefound", () => {
          watchWorker(registration.installing);
        });
        watchWorker(registration.installing);
        detectWaiting();
        queryOffline();
        void check();
        return registration;
      } catch {
        publish({
          status: nav?.onLine === false ? "offline" : "error",
          message:
            "Não foi possível preparar as atualizações agora. Abra o site conectado e tente novamente.",
        });
        return null;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  function destroy() {
    if (destroyed) return;
    // Fechar primeiro o controller impede que callbacks de liberação iniciem
    // uma segunda atualização enquanto a interface está sendo desmontada.
    destroyed = true;
    state = Object.freeze({ ...state, locked: false });
    if (handshake)
      post(handshake.worker, {
        type: "UPDATE_BLOCKED",
        requestId: handshake.id,
        reasons: [
          "Uma aba está sendo encerrada. A atualização pode ser tentada novamente.",
        ],
      });
    unlock();
    if (attemptTimer !== null) timers.clearTimeout(attemptTimer);
    if (interval !== null) timers.clearInterval(interval);
    cleanups.splice(0).forEach((cleanup) => cleanup());
  }

  return {
    start,
    check,
    apply,
    refreshSafety,
    setAutomatic,
    destroy,
    get state() {
      return state;
    },
  };
}
