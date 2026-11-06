import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateManager } from "../dist/updates.mjs";

class Target {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event); }
  get listenerCount() { return [...this.listeners.values()].reduce((count, entries) => count + entries.size, 0); }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() { await new Promise(setImmediate); }

function fixture(options = {}) {
  const win = new Target();
  const doc = new Target();
  doc.visibilityState = "visible";
  const sw = new Target();
  const active = { postMessage(message) { active.messages.push(message); }, messages: [] };
  sw.controller = options.initialInstall ? null : active;
  const waiting = new Target();
  waiting.state = "installed";
  waiting.messages = [];
  waiting.postMessage = (message) => { waiting.messages.push(message); };
  const registration = new Target();
  registration.waiting = options.waiting === false ? null : waiting;
  registration.active = active;
  registration.installing = null;
  const registrations = [];
  let updates = 0;
  registration.update = async () => { updates++; if (options.updateFails) throw new Error("rede indisponível"); };
  sw.register = async (...args) => { registrations.push(args); return registration; };
  const nav = { serviceWorker: sw, onLine: options.offline !== true };
  const timers = new Map();
  let now = 0;
  let timerId = 0;
  const addTimer = (callback, delay, repeat) => {
    const id = ++timerId;
    timers.set(id, { callback, at: now + delay, delay, repeat });
    return id;
  };
  const locks = [];
  const states = [];
  const order = [];
  const guard = { safe: options.safe !== false, reasons: options.reasons ?? ["Coleta real em andamento."] };
  let reloads = 0;
  let checkpoints = 0;
  const fetches = [];
  const manager = createUpdateManager({
    navigator: nav, window: win, document: doc,
    isSafe: () => options.isSafe ? options.isSafe() : guard,
    onState: (state) => { states.push(state); options.onState?.(state); },
    onLock: (locked) => { locks.push(locked); order.push(`lock:${locked}`); options.onLock?.(locked); },
    beforeActivate: async () => { checkpoints++; order.push("checkpoint"); await options.beforeActivate?.(); },
    reload: () => { reloads++; order.push("reload"); },
    fetch: async (...args) => {
      fetches.push(args);
      if (options.fetchFails) throw new Error("offline");
      return new Response(options.loginResponse ? "<html>Login</html>" : JSON.stringify({ version: "2.1.0", cacheVersion: "v3" }), { headers: { "Content-Type": options.loginResponse ? "text/html" : "application/json" } });
    },
    setInterval: (callback, delay) => addTimer(callback, delay, true),
    clearInterval: (id) => timers.delete(id),
    setTimeout: (callback, delay) => addTimer(callback, delay, false),
    clearTimeout: (id) => timers.delete(id),
  });
  if (options.automatic === false) manager.setAutomatic(false);
  return {
    manager, win, doc, sw, nav, waiting, registration, active, guard,
    registrations, timers, locks, states, order, fetches,
    get updates() { return updates; },
    get reloads() { return reloads; },
    get checkpoints() { return checkpoints; },
    async start() { await manager.start(); await settle(); },
    message(type, data = {}, source = waiting) { sw.emit("message", { data: { type, ...data }, source }); },
    prepare(id = "v3-request", mode = "manual") { sw.emit("message", { data: { type: "UPDATE_PREPARE", requestId: id, mode }, source: waiting }); },
    changeController() { sw.controller = { postMessage() {} }; sw.emit("controllerchange"); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry;
        now = timer.at;
        if (timer.repeat) timer.at += timer.delay;
        else timers.delete(id);
        timer.callback();
        await settle();
      }
      now = end;
    },
  };
}

test("registra o mesmo PWA sem cache do script e verifica abertura, foco, rede e intervalo", async () => {
  const f = fixture({ waiting: false, automatic: false });
  await f.start();
  assert.deepEqual(f.registrations, [["./sw.js", { scope: "./", updateViaCache: "none" }]]);
  assert.equal(f.updates, 1);
  assert.equal(f.manager.state.release.version, "2.1.0");
  assert.equal(f.fetches[0][1].cache, "no-store");
  f.win.emit("focus"); await settle();
  assert.equal(f.updates, 2);
  f.doc.visibilityState = "hidden";
  f.doc.emit("visibilitychange"); await settle();
  assert.equal(f.updates, 2);
  f.doc.visibilityState = "visible";
  f.doc.emit("visibilitychange"); await settle();
  f.win.emit("online"); await settle();
  assert.equal(f.updates, 4);
  await f.advance(10 * 60 * 1000);
  assert.equal(f.updates, 5);
  assert.ok(f.active.messages.some((message) => message.type === "CHECK_OFFLINE_READY"));
  f.manager.destroy();
  assert.equal(f.timers.size, 0);
  assert.equal(f.sw.listenerCount + f.win.listenerCount + f.doc.listenerCount + f.registration.listenerCount, 0);
  f.win.emit("focus"); await settle();
  assert.equal(f.updates, 5);
});

test("sem internet usa a instalação existente e preserva a confirmação de prontidão offline", async () => {
  const f = fixture({ offline: true, waiting: false });
  await f.start();
  assert.equal(f.updates, 0);
  assert.equal(f.fetches.length, 0);
  assert.equal(f.manager.state.status, "offline");
  f.message("OFFLINE_READY", { version: "v3" }, f.active);
  assert.equal(f.manager.state.offlineReady, true);
  assert.equal(f.manager.state.version, "v3");
  f.nav.onLine = true;
  f.win.emit("online"); await settle();
  assert.equal(f.updates, 1);
  f.message("OFFLINE_UNAVAILABLE", {}, f.active);
  assert.equal(f.manager.state.offlineReady, false);
  f.manager.destroy();
});

test("a atualização automática só reabre após trava, checkpoint e acordo das abas", async () => {
  const f = fixture();
  await f.start();
  assert.equal(f.waiting.messages.filter((message) => message.type === "ACTIVATE_WHEN_SAFE").length, 1);
  assert.equal(f.waiting.messages[0].mode, "automatic");
  assert.equal(f.reloads, 0);
  f.prepare("agreement", "automatic");
  assert.equal(f.manager.state.locked, true);
  await settle();
  assert.deepEqual(f.order, ["lock:true", "checkpoint"]);
  assert.ok(f.waiting.messages.some((message) => message.type === "UPDATE_READY" && message.requestId === "agreement"));
  assert.ok(!f.waiting.messages.some((message) => message.type === "SKIP_WAITING"));
  f.message("UPDATE_COMMIT", { requestId: "agreement" });
  assert.equal(f.reloads, 0);
  f.changeController(); await settle();
  assert.equal(f.reloads, 1);
  assert.equal(f.order.at(-1), "reload");
  f.changeController(); await settle();
  assert.equal(f.reloads, 1);
  f.manager.destroy();
  assert.deepEqual(f.locks, [true, false]);
});

test("coleta, conexão, rascunho, importação e gravação local adiam atualização sem perder estado", async () => {
  for (const reason of ["Coleta real em andamento.", "Conexão com scanner ativa.", "Rascunho não salvo.", "Importação em andamento.", "Gravação local em andamento."]) {
    const f = fixture({ safe: false, reasons: [reason] });
    await f.start();
    assert.equal(f.manager.state.status, "deferred");
    assert.deepEqual(f.manager.state.reasons, [reason]);
    assert.equal(await f.manager.apply(), false);
    assert.equal(f.waiting.messages.length, 0);
    f.prepare("busy", "automatic"); await settle();
    assert.ok(f.waiting.messages.some((message) => message.type === "UPDATE_BLOCKED" && message.reasons.includes(reason)));
    assert.equal(f.locks.length, 0);
    assert.equal(f.reloads, 0);
    f.message("UPDATE_ABORT", { requestId: "busy", reasons: [reason] });
    f.guard.safe = true;
    f.manager.refreshSafety(); await settle();
    assert.ok(f.waiting.messages.some((message) => message.type === "ACTIVATE_WHEN_SAFE"));
    f.manager.destroy();
  }
});

test("preferência manual bloqueia pedidos automáticos de outra aba e permite atualização manual segura", async () => {
  const f = fixture({ automatic: false });
  await f.start();
  assert.equal(f.waiting.messages.length, 0);
  f.prepare("automatic-request", "automatic"); await settle();
  assert.equal(f.waiting.messages.at(-1).type, "UPDATE_BLOCKED");
  assert.equal(f.locks.length, 0);
  assert.equal(await f.manager.apply(), true);
  assert.equal(f.waiting.messages.at(-1).mode, "manual");
  f.prepare("manual-request", "manual"); await settle();
  assert.equal(f.waiting.messages.at(-1).type, "UPDATE_READY");
  f.message("UPDATE_COMMIT", { requestId: "manual-request" });
  f.changeController(); await settle();
  assert.equal(f.reloads, 1);
  f.manager.destroy();
});

test("falha de checkpoint informa bloqueio e libera a interface", async () => {
  const f = fixture({ automatic: false, beforeActivate: () => { throw new Error("falha de persistência"); } });
  await f.start();
  f.prepare(); await settle();
  assert.deepEqual(f.locks, [true, false]);
  assert.equal(f.manager.state.locked, false);
  assert.equal(f.manager.state.status, "deferred");
  assert.ok(f.waiting.messages.some((message) => message.type === "UPDATE_BLOCKED"));
  assert.ok(!f.waiting.messages.some((message) => message.type === "UPDATE_READY"));
  assert.equal(f.reloads, 0);
  f.manager.destroy();
});

test("abort de outra aba libera a trava e permite nova tentativa sem reiniciar", async () => {
  const f = fixture({ automatic: false });
  await f.start();
  await f.manager.apply();
  f.prepare("first"); await settle();
  f.message("UPDATE_ABORT", { requestId: "first", reasons: ["Outra aba está em coleta."] });
  assert.deepEqual(f.locks, [true, false]);
  assert.equal(f.manager.state.locked, false);
  assert.equal(f.reloads, 0);
  assert.equal(await f.manager.apply(), true);
  f.manager.destroy();
});

test("timeout libera checkpoint travado e uma promessa atrasada não pode confirmar a versão", async () => {
  const pending = deferred();
  const f = fixture({ automatic: false, beforeActivate: () => pending.promise });
  await f.start();
  f.prepare("stalled");
  assert.equal(f.manager.state.locked, true);
  await f.advance(12 * 1000);
  assert.equal(f.manager.state.locked, false);
  assert.deepEqual(f.locks, [true, false]);
  assert.ok(f.waiting.messages.some((message) => message.type === "UPDATE_BLOCKED"));
  pending.resolve(); await settle();
  assert.ok(!f.waiting.messages.some((message) => message.type === "UPDATE_READY"));
  assert.equal(f.reloads, 0);
  f.manager.destroy();
});

test("worker sem resposta não deixa o sistema em preparação indefinidamente", async () => {
  const f = fixture({ automatic: false });
  await f.start();
  await f.manager.apply();
  assert.equal(f.manager.state.status, "preparing");
  await f.advance(12 * 1000);
  assert.equal(f.manager.state.status, "deferred");
  assert.equal(f.manager.state.locked, false);
  assert.equal(await f.manager.apply(), true);
  f.manager.destroy();
});

test("controllerchange inesperado durante uma operação não reinicia; fim da operação permite reabrir", async () => {
  const f = fixture({ waiting: false, safe: false, reasons: ["Dados de coleta ainda não salvos."] });
  await f.start();
  f.changeController(); await settle();
  assert.equal(f.reloads, 0);
  assert.equal(f.manager.state.pendingReload, true);
  assert.equal(f.manager.state.locked, false);
  f.guard.safe = true;
  f.manager.refreshSafety(); await settle();
  assert.equal(f.reloads, 1);
  assert.deepEqual(f.order, ["lock:true", "checkpoint", "reload"]);
  f.manager.destroy();
});

test("uma operação detectada após READY também impede a reabertura", async () => {
  const f = fixture({ automatic: false });
  await f.start();
  f.prepare("late-operation"); await settle();
  f.message("UPDATE_COMMIT", { requestId: "late-operation" });
  f.guard.safe = false;
  f.changeController(); await settle();
  assert.equal(f.reloads, 0);
  assert.equal(f.manager.state.pendingReload, true);
  assert.deepEqual(f.locks, [true, false]);
  f.guard.safe = true;
  assert.equal(await f.manager.apply(), true);
  assert.equal(f.reloads, 1);
  assert.equal(f.checkpoints, 2);
  f.manager.destroy();
});

test("controllerchange durante prepare aguarda o checkpoint pendente antes de reabrir", async () => {
  const pending = deferred();
  const f = fixture({ automatic: false, beforeActivate: () => pending.promise });
  await f.start();
  await f.manager.apply();
  f.prepare("pending-checkpoint");
  f.changeController(); await settle();
  assert.equal(f.reloads, 0);
  assert.equal(f.checkpoints, 1);
  assert.equal(f.manager.state.locked, true);
  pending.resolve(); await settle();
  assert.equal(f.reloads, 1);
  assert.deepEqual(f.order, ["lock:true", "checkpoint", "reload"]);
  f.manager.destroy();
});

test("controllerchange repetido compartilha a preparação em vez de ultrapassá-la", async () => {
  const pending = deferred();
  const f = fixture({ waiting: false, beforeActivate: () => pending.promise });
  await f.start();
  f.changeController(); await settle();
  f.changeController(); await settle();
  assert.equal(f.reloads, 0);
  assert.equal(f.checkpoints, 1);
  pending.resolve(); await settle();
  assert.equal(f.reloads, 1);
  assert.deepEqual(f.locks, [true]);
  f.manager.destroy();
});

test("primeiro controller da instalação não reinicia o aplicativo", async () => {
  const f = fixture({ initialInstall: true, waiting: false });
  await f.start();
  f.changeController(); await settle();
  assert.equal(f.reloads, 0);
  assert.equal(f.checkpoints, 0);
  assert.equal(f.manager.state.pendingReload, false);
  f.manager.destroy();
});

test("encerrar o manager remove eventos, prazos e uma trava ainda em preparação", async () => {
  const pending = deferred();
  const f = fixture({ automatic: false, beforeActivate: () => pending.promise });
  await f.start();
  f.prepare("closing");
  f.manager.destroy();
  assert.deepEqual(f.locks, [true, false]);
  assert.equal(f.timers.size, 0);
  assert.equal(f.sw.listenerCount + f.win.listenerCount + f.doc.listenerCount + f.registration.listenerCount, 0);
  pending.resolve(); await settle();
  assert.equal(f.reloads, 0);
  assert.ok(!f.waiting.messages.some((message) => message.type === "UPDATE_READY"));
  assert.equal(await f.manager.apply(), false);
  assert.equal(await f.manager.start(), null);
});

test("mudança para atualização manual durante preparo automático libera a trava", async () => {
  const f = fixture();
  await f.start();
  f.prepare("automatic", "automatic"); await settle();
  f.manager.setAutomatic(false);
  assert.equal(f.manager.state.automatic, false);
  assert.equal(f.manager.state.locked, false);
  assert.deepEqual(f.locks, [true, false]);
  assert.equal(f.waiting.messages.at(-1).type, "UPDATE_BLOCKED");
  f.manager.destroy();
});

test("callback da liberação não pode reiniciar o manager durante destroy", async () => {
  let f;
  f = fixture({ automatic: false, onLock(locked) {
    if (!locked) { f.manager.setAutomatic(true); f.manager.refreshSafety(); void f.manager.check(); }
  } });
  await f.start();
  f.prepare("unmount"); await settle();
  f.manager.destroy(); await settle();
  assert.equal(f.manager.state.locked, false);
  assert.equal(f.timers.size, 0);
  assert.ok(!f.waiting.messages.some((message) => message.type === "ACTIVATE_WHEN_SAFE"));
  assert.equal(f.reloads, 0);
});

test("metadados de autenticação e falha de rede não substituem a instalação atual", async () => {
  const f = fixture({ waiting: false, loginResponse: true, updateFails: true });
  await f.start();
  assert.equal(f.manager.state.release, null);
  assert.equal(f.manager.state.status, "offline");
  assert.equal(f.reloads, 0);
  assert.equal(f.locks.length, 0);
  f.manager.destroy();
});

test("navegador sem service worker e verificação de segurança com erro falham fechados", async () => {
  const states = [];
  const manager = createUpdateManager({ navigator: {}, window: {}, document: {}, onState: (state) => states.push(state) });
  assert.equal(await manager.start(), null);
  assert.equal(states.at(-1).status, "unsupported");
  assert.equal(await manager.apply(), false);
  manager.destroy();
  const f = fixture({ isSafe() { throw new Error("guard indisponível"); } });
  await f.start();
  assert.equal(f.waiting.messages.length, 0);
  f.prepare(); await settle();
  assert.equal(f.waiting.messages.at(-1).type, "UPDATE_BLOCKED");
  assert.equal(f.reloads, 0);
  f.manager.destroy();
});
