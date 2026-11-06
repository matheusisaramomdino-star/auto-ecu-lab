import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("dist/manifest.webmanifest", root), "utf8"),
);
const source = await readFile(new URL("dist/sw.js", root), "utf8");
const release = JSON.parse(await readFile(new URL("dist/release.json", root), "utf8"));
const origin = "https://example.test/";
const marker = '<meta name="auto-ecu-lab-app" content="v1">';

function makeRuntime(options = {}) {
  const listeners = {};
  const cacheMaps = new Map();
  const messages = [];
  let waitingCalls = 0;
  let offline = false;
  const fetchCalls = [];
  const timeouts = new Map();
  let timerSequence = 0;
  const clients = [];
  function client(id) {
    const sent = [];
    const value = { id, url: origin, messages: sent, postMessage(message) { sent.push(message); messages.push(message); } };
    clients.push(value);
    return value;
  }
  client("tab-1");
  const caches = {
    async keys() {
      return [...cacheMaps.keys()];
    },
    async delete(name) {
      return cacheMaps.delete(name);
    },
    async open(name) {
      if (!cacheMaps.has(name)) cacheMaps.set(name, new Map());
      const contents = cacheMaps.get(name);
      return {
        async match(key) {
          return contents.get(typeof key === "string" ? key : key.url)?.clone();
        },
        async put(key, response) {
          contents.set(typeof key === "string" ? key : key.url, response.clone());
        },
      };
    },
  };
  const self = {
    registration: { scope: origin },
    clients: {
      async matchAll() {
        return [...clients];
      },
      async claim() {},
    },
    async skipWaiting() {
      waitingCalls++;
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
  };
  async function fetch(request) {
    const url = typeof request === "string" ? request : request.url;
    fetchCalls.push(url);
    if (offline) throw new Error("offline");
    const path = new URL(url).pathname;
    let contentType = "application/javascript";
    let body = "export const test = true;";
    if (path === "/" || path.endsWith("index.html")) {
      contentType = "text/html";
      body = options.loginHtml ? "<html>Entre para continuar</html>" : `<html>${marker}</html>`;
    } else if (path.endsWith(".css")) {
      contentType = "text/css";
      body = "body{}";
    } else if (path.endsWith(".webmanifest")) {
      contentType = "application/manifest+json";
      body = "{}";
    } else if (path.endsWith(".json")) {
      contentType = "application/json";
      body = options.badJson ? "not-json" : JSON.stringify(release);
    } else if (path.endsWith(".png")) {
      contentType = "image/png";
      body = "image";
    } else if (path.endsWith(".svg")) {
      contentType = "image/svg+xml";
      body = "<svg/>";
    }
    const response = new Response(body, {
      status: options.failPath === path ? 503 : options.badStatus || 200,
      headers: { "Content-Type": contentType },
    });
    Object.defineProperty(response, "url", { value: url });
    Object.defineProperty(response, "redirected", { value: Boolean(options.redirected) });
    return response;
  }
  vm.runInNewContext(source, {
    self, caches, fetch, URL, Response, console,
    setTimeout(callback, delay) { const id = ++timerSequence; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  });
  const runtime = {
    listeners,
    caches,
    messages,
    fetchCalls,
    clients,
    client,
    timeouts,
    expireTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      pending.forEach(({ callback }) => callback());
    },
    setOffline(value) {
      offline = value;
    },
    get waitingCalls() {
      return waitingCalls;
    },
    async trigger(name, extra = {}) {
      let work = Promise.resolve();
      listeners[name]({ ...extra, waitUntil: (promise) => { work = promise; } });
      return work;
    },
    request(path, { method = "GET", mode = "navigate" } = {}) {
      let response;
      listeners.fetch({
        request: { url: new URL(path, origin).href, method, mode },
        respondWith: (result) => { response = result; },
      });
      return response;
    },
  };
  return runtime;
}

test("manifesto configura aplicativo standalone em português", () => {
  assert.equal(manifest.name, "AUTO ECU LAB — Auto Elétrica Doidinho");
  assert.equal(manifest.lang, "pt-BR");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.theme_color, "#141414");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("ícones PNG têm as dimensões necessárias para iOS e Android", async () => {
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180], ["maskable-512.png", 512]]) {
    const bytes = await readFile(new URL(`dist/assets/${name}`, root));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test("preparo completo informa OFFLINE_READY sem forçar uma atualização", async () => {
  const runtime = makeRuntime();
  await runtime.trigger("install");
  assert.equal(runtime.waitingCalls, 0);
  assert.ok(runtime.messages.some((message) => message.type === "OFFLINE_READY"));
  for (const file of ["app.mjs", "chart.mjs", "core.mjs", "real-base.mjs", "statistics.mjs", "store.mjs", "report.mjs", "updates.mjs", "preferences.mjs", "modules.mjs", "release.json", "style.css", "manifest.webmanifest", "assets/apple-touch-icon.png"]) {
    assert.ok(runtime.fetchCalls.includes(new URL(file, origin).href));
  }
});

test("shell continua disponível sem rede após instalação completa", async () => {
  const runtime = makeRuntime();
  await runtime.trigger("install");
  runtime.setOffline(true);
  const response = await runtime.request("/");
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(marker));
  assert.equal((await runtime.request("/index.html")).status, 200);
  assert.ok(!runtime.fetchCalls.includes(origin + "index.html"));
  assert.equal((await runtime.request("/core.mjs")).status, 200);
  assert.equal((await runtime.request("/real-base.mjs")).status, 200);
  assert.equal((await runtime.request("/statistics.mjs")).status, 200);
});

test("pedidos de login, API, relatórios, consulta, POST e outros domínios não são interceptados", () => {
  const runtime = makeRuntime();
  for (const url of ["/auth/login", "/api/ensaios", "/relatorio.html", "/dados.csv", "/samples/strada.csv", "/?auth=code", "/unknown", "https://outside.test/app.mjs"]) {
    assert.equal(runtime.request(url), undefined, url);
  }
  assert.equal(runtime.request("/app.mjs", { method: "POST" }), undefined);
});

test("redirecionamentos de autenticação não entram no cache", async () => {
  const runtime = makeRuntime({ redirected: true });
  await assert.rejects(runtime.trigger("install"));
  assert.deepEqual(await runtime.caches.keys(), []);
  assert.equal(runtime.messages.length, 0);
});

test("página HTML de login com status 200 também não é guardada", async () => {
  const runtime = makeRuntime({ loginHtml: true });
  await assert.rejects(runtime.trigger("install"), /não é o aplicativo/);
  assert.deepEqual(await runtime.caches.keys(), []);
});

test("respostas com erro impedem disponibilidade offline", async () => {
  const runtime = makeRuntime({ badStatus: 500 });
  await assert.rejects(runtime.trigger("install"));
  assert.deepEqual(await runtime.caches.keys(), []);
});

test("ativação remove apenas caches antigos do AUTO ECU LAB", async () => {
  const runtime = makeRuntime();
  await runtime.caches.open("outro-aplicativo-v1");
  await runtime.caches.open("auto-ecu-lab-shell-antigo");
  await runtime.trigger("install");
  await runtime.trigger("activate");
  assert.ok((await runtime.caches.keys()).includes("outro-aplicativo-v1"));
  assert.ok(!(await runtime.caches.keys()).includes("auto-ecu-lab-shell-antigo"));
});

test("atualização só chama skipWaiting após mensagem explícita", async () => {
  const runtime = makeRuntime();
  await runtime.trigger("install");
  assert.equal(runtime.waitingCalls, 0);
  await runtime.trigger("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(runtime.waitingCalls, 1);
});

test("consulta de prontidão distingue um shell incompleto", async () => {
  const runtime = makeRuntime();
  const messages = [];
  await runtime.trigger("message", { data: { type: "CHECK_OFFLINE_READY" }, source: { postMessage: (message) => messages.push(message) } });
  assert.equal(messages[0].type, "OFFLINE_UNAVAILABLE");
  await runtime.trigger("install");
  await runtime.trigger("message", { data: { type: "CHECK_OFFLINE_READY" }, source: { postMessage: (message) => messages.push(message) } });
  assert.equal(messages[1].type, "OFFLINE_READY");
});

test("sem shell e sem rede, a falha explica o preparo necessário", async () => {
  const runtime = makeRuntime();
  runtime.setOffline(true);
  const response = await runtime.request("/");
  assert.equal(response.status, 503);
  assert.match(await response.text(), /preparo offline/);
});

async function beginUpdate(runtime, mode = "automatic") {
  const work = runtime.trigger("message", { data: { type: "ACTIVATE_WHEN_SAFE", mode }, source: runtime.clients[0] });
  await new Promise(setImmediate);
  const prepare = runtime.clients[0].messages.findLast((message) => message.type === "UPDATE_PREPARE");
  assert.ok(prepare, "O worker deve solicitar confirmação antes de ativar");
  return { work, prepare };
}

function acknowledge(runtime, client, prepare, type = "UPDATE_READY", reasons = []) {
  return runtime.trigger("message", { data: { type, requestId: prepare.requestId, reasons }, source: client });
}

test("atualização automática exige confirmação de todas as abas", async () => {
  const runtime = makeRuntime();
  const second = runtime.client("tab-2");
  await runtime.trigger("install");
  const { work, prepare } = await beginUpdate(runtime);
  await acknowledge(runtime, runtime.clients[0], prepare);
  assert.equal(runtime.waitingCalls, 0);
  await acknowledge(runtime, second, prepare);
  await work;
  assert.equal(runtime.waitingCalls, 1);
  assert.ok(runtime.clients.every((client) => client.messages.some((message) => message.type === "UPDATE_COMMIT")));
  assert.equal(runtime.timeouts.size, 0);
});

test("aba em coleta bloqueia atualização e todas as travas são liberadas", async () => {
  const runtime = makeRuntime();
  const second = runtime.client("tab-2");
  await runtime.trigger("install");
  const { work, prepare } = await beginUpdate(runtime);
  await acknowledge(runtime, runtime.clients[0], prepare);
  await acknowledge(runtime, second, prepare, "UPDATE_BLOCKED", ["Coleta real em andamento."]);
  await work;
  assert.equal(runtime.waitingCalls, 0);
  assert.ok(runtime.clients.every((client) => client.messages.some((message) => message.type === "UPDATE_ABORT")));
  assert.ok(runtime.messages.some((message) => message.reasons?.includes("Coleta real em andamento.")));
  assert.equal(runtime.timeouts.size, 0);
});

test("aba antiga sem o protocolo impede ativação após timeout", async () => {
  const runtime = makeRuntime();
  runtime.client("legacy-tab");
  await runtime.trigger("install");
  const { work, prepare } = await beginUpdate(runtime);
  await acknowledge(runtime, runtime.clients[0], prepare);
  runtime.expireTimeouts();
  await work;
  assert.equal(runtime.waitingCalls, 0);
  assert.ok(runtime.messages.some((message) => message.type === "UPDATE_ABORT"));
  // O prazo encerrado não deixa o worker permanentemente ocupado.
  runtime.clients.pop();
  const retry = await beginUpdate(runtime, "manual");
  await acknowledge(runtime, runtime.clients[0], retry.prepare);
  await retry.work;
  assert.equal(runtime.waitingCalls, 1);
});

test("uma aba aberta durante a confirmação adia a ativação", async () => {
  const runtime = makeRuntime();
  await runtime.trigger("install");
  const { work, prepare } = await beginUpdate(runtime);
  runtime.client("new-tab");
  await acknowledge(runtime, runtime.clients[0], prepare);
  await work;
  assert.equal(runtime.waitingCalls, 0);
  assert.ok(runtime.messages.some((message) => message.type === "UPDATE_DEFERRED" && message.reasons.some((reason) => /abas mudou/.test(reason))));
});

test("respostas de outra aba ou solicitação não autorizam a ativação", async () => {
  const runtime = makeRuntime();
  await runtime.trigger("install");
  const { work, prepare } = await beginUpdate(runtime);
  await acknowledge(runtime, { id: "forged-tab" }, prepare);
  await acknowledge(runtime, runtime.clients[0], { requestId: "old-request" });
  assert.equal(runtime.waitingCalls, 0);
  runtime.expireTimeouts();
  await work;
  assert.equal(runtime.waitingCalls, 0);
});

test("shell incompleto nunca pode ativar pelo protocolo seguro", async () => {
  const runtime = makeRuntime();
  await runtime.trigger("message", { data: { type: "ACTIVATE_WHEN_SAFE" }, source: runtime.clients[0] });
  assert.equal(runtime.waitingCalls, 0);
  assert.ok(runtime.messages.some((message) => message.type === "UPDATE_DEFERRED"));
});

test("falha do novo precache preserva o shell da versão anterior", async () => {
  const runtime = makeRuntime({ failPath: "/updates.mjs" });
  const previous = await runtime.caches.open("auto-ecu-lab-shell-v2");
  await previous.put(origin, new Response("versão anterior"));
  await assert.rejects(runtime.trigger("install"));
  assert.deepEqual(await runtime.caches.keys(), ["auto-ecu-lab-shell-v2"]);
  assert.equal(await (await previous.match(origin)).text(), "versão anterior");
});

test("ativação conserva a geração anterior para recuperação e não toca outros dados", async () => {
  const runtime = makeRuntime();
  for (const name of ["auto-ecu-lab-shell-v1", "auto-ecu-lab-shell-v3", "diagnosticos-locais"]) await runtime.caches.open(name);
  await runtime.trigger("install");
  await runtime.trigger("activate");
  assert.deepEqual((await runtime.caches.keys()).sort(), ["auto-ecu-lab-shell-v3", `auto-ecu-lab-shell-${release.cacheVersion}`, "diagnosticos-locais"].sort());
  assert.ok(!/indexedDB\s*\.\s*deleteDatabase/.test(source));
});

test("release.json usa rede quando disponível e a cópia instalada sem internet", async () => {
  const runtime = makeRuntime();
  await runtime.trigger("install");
  const count = runtime.fetchCalls.length;
  assert.equal((await (await runtime.request("/release.json")).json()).version, release.version);
  assert.equal(runtime.fetchCalls.length, count + 1);
  runtime.setOffline(true);
  assert.equal((await (await runtime.request("/release.json")).json()).version, release.version);
});

test("JSON inválido impede preparar uma versão incompleta", async () => {
  const runtime = makeRuntime({ badJson: true });
  await assert.rejects(runtime.trigger("install"));
  assert.deepEqual(await runtime.caches.keys(), []);
});

test("aba fechada durante a notificação não desfaz o shell já preparado", async () => {
  const runtime = makeRuntime();
  runtime.clients[0].postMessage = () => { throw new Error("aba encerrada"); };
  await runtime.trigger("install");
  await runtime.trigger("activate");
  runtime.setOffline(true);
  assert.equal((await runtime.request("/")).status, 200);
});
