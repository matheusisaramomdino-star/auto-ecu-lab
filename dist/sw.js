/* AUTO ECU LAB: somente o shell local. Aumente CACHE_VERSION em cada publicação. */
"use strict";

const CACHE_PREFIX = "auto-ecu-lab-shell-";
const CACHE_VERSION = "v4";
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const SCOPE = new URL(self.registration.scope);
const APP_MARKER = '<meta name="auto-ecu-lab-app" content="v1">';
const SHELL_FILES = [
  "./",
  "./app.mjs",
  "./chart.mjs",
  "./catalog.mjs",
  "./modes.mjs",
  "./connections.mjs",
  "./obd.mjs",
  "./transports.mjs",
  "./core.mjs",
  "./real-base.mjs",
  "./statistics.mjs",
  "./store.mjs",
  "./report.mjs",
  "./updates.mjs",
  "./preferences.mjs",
  "./modules.mjs",
  "./release.json",
  "./style.css",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/maskable-512.png",
];
const SHELL_URLS = SHELL_FILES.map((path) => new URL(path, SCOPE).href);
const INDEX_URL = new URL("./index.html", SCOPE).href;
const READY_URLS = [...SHELL_URLS, INDEX_URL];
const ALLOWED_URLS = new Set(READY_URLS);
const RELEASE_URL = new URL("./release.json", SCOPE).href;
const PREPARE_TIMEOUT = 8000;
let activation = null;
let activationSequence = 0;

function allowedRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return (
    url.origin === SCOPE.origin &&
    !url.search &&
    !url.hash &&
    ALLOWED_URLS.has(url.href)
  );
}

async function shellResponse(url) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-cache",
    redirect: "follow",
  });
  const actualUrl = new URL(response.url || url);
  if (
    response.status !== 200 ||
    response.redirected ||
    response.type === "opaque" ||
    actualUrl.href !== url
  ) {
    throw new Error("Não foi possível preparar um arquivo do aplicativo.");
  }
  const path = actualUrl.pathname;
  const contentType = response.headers.get("Content-Type") || "";
  if (path.endsWith("/") || path.endsWith("/index.html")) {
    if (
      !contentType.includes("text/html") ||
      !(await response.clone().text()).includes(APP_MARKER)
    ) {
      throw new Error("A página recebida não é o aplicativo AUTO ECU LAB.");
    }
  } else if (path.endsWith(".mjs")) {
    if (!/javascript/i.test(contentType)) {
      throw new Error("Módulo do aplicativo indisponível.");
    }
  } else if (path.endsWith(".css")) {
    if (!contentType.includes("text/css")) {
      throw new Error("Estilo do aplicativo indisponível.");
    }
  } else if (path.endsWith(".webmanifest") || path.endsWith(".json")) {
    if (!/json/i.test(contentType)) {
      throw new Error("Manifesto do aplicativo indisponível.");
    }
    if (path.endsWith(".json")) await response.clone().json();
  } else if (path.endsWith(".png") || path.endsWith(".svg")) {
    if (!contentType.startsWith("image/")) {
      throw new Error("Ícone do aplicativo indisponível.");
    }
  }
  return response;
}

async function isOfflineReady() {
  const cache = await caches.open(CACHE_NAME);
  const entries = await Promise.all(READY_URLS.map((url) => cache.match(url)));
  return entries.every(Boolean);
}

async function announceReady() {
  if (!(await isOfflineReady())) return;
  const clients = await appClients();
  clients.forEach((client) =>
    reply(client, { type: "OFFLINE_READY", version: CACHE_VERSION }),
  );
}

async function appClients() {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  return clients.filter((client) => {
    try {
      const url = new URL(client.url);
      return (
        Boolean(client.id) &&
        url.origin === SCOPE.origin &&
        url.pathname.startsWith(SCOPE.pathname)
      );
    } catch {
      return false;
    }
  });
}

function reply(client, message) {
  try {
    client?.postMessage(message);
  } catch {
    /* Uma aba pode ter sido fechada. */
  }
}

function reasonsFrom(message, fallback) {
  const reasons = Array.isArray(message?.reasons)
    ? message.reasons
        .filter((reason) => typeof reason === "string" && reason.trim())
        .slice(0, 12)
    : [];
  return reasons.length ? reasons : [fallback];
}

async function activateWhenSafe(event) {
  if (activation) {
    reply(event.source, {
      type: "UPDATE_DEFERRED",
      reasons: ["Outra aba já está verificando esta atualização."],
    });
    return;
  }
  const attempt = {
    id: `${CACHE_VERSION}-${Date.now()}-${++activationSequence}`,
    clients: [],
    acknowledgements: new Set(),
    timer: null,
    resolve: null,
    rejected: false,
    reasons: [],
  };
  activation = attempt;
  try {
    if (!(await isOfflineReady()))
      throw new Error(
        "Os arquivos da nova versão ainda não estão preparados para uso offline.",
      );
    attempt.clients = await appClients();
    if (
      !event.source?.id ||
      !attempt.clients.some((client) => client.id === event.source.id)
    ) {
      throw new Error(
        "Não foi possível identificar todas as abas do aplicativo. Reabra a página e tente novamente.",
      );
    }
    const approved = await new Promise((resolve) => {
      attempt.resolve = resolve;
      attempt.timer = setTimeout(() => {
        attempt.rejected = true;
        attempt.reasons = [
          "Uma aba não confirmou que pode atualizar. Conclua as operações ou feche as outras abas e tente novamente.",
        ];
        resolve(false);
      }, PREPARE_TIMEOUT);
      const message = {
        type: "UPDATE_PREPARE",
        requestId: attempt.id,
        mode: event.data?.mode === "automatic" ? "automatic" : "manual",
      };
      attempt.clients.forEach((client) => reply(client, message));
    });
    if (!approved || attempt.rejected)
      throw new Error(
        attempt.reasons[0] ??
          "Outra aba precisa concluir suas operações antes da atualização.",
      );
    // Uma aba aberta durante o preparo também precisa participar. Adiar evita
    // trocar a versão por baixo de uma sessão que não recebeu a trava.
    const current = await appClients();
    if (
      attempt.rejected ||
      current.length !== attempt.clients.length ||
      current.some((client) => !attempt.acknowledgements.has(client.id))
    ) {
      throw new Error(
        "O conjunto de abas mudou durante o preparo. A atualização será tentada novamente com todas as abas.",
      );
    }
    clearTimeout(attempt.timer);
    attempt.timer = null;
    attempt.clients.forEach((client) =>
      reply(client, {
        type: "UPDATE_COMMIT",
        requestId: attempt.id,
        version: CACHE_VERSION,
      }),
    );
    await self.skipWaiting();
  } catch (error) {
    const reasons = attempt.reasons.length
      ? attempt.reasons
      : [
          error.message ||
            "A atualização foi adiada para preservar as operações locais.",
        ];
    attempt.clients.forEach((client) =>
      reply(client, { type: "UPDATE_ABORT", requestId: attempt.id, reasons }),
    );
    reply(event.source, {
      type: "UPDATE_DEFERRED",
      requestId: attempt.id,
      reasons,
    });
  } finally {
    if (attempt.timer !== null) clearTimeout(attempt.timer);
    if (activation === attempt) activation = null;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const alreadyExists = (await caches.keys()).includes(CACHE_NAME);
      try {
        // Validar todos os arquivos antes de escrever evita um shell parcial.
        const responses = await Promise.all(SHELL_URLS.map(shellResponse));
        // Hosts estáticos podem redirecionar /index.html para /. Guarde o
        // HTML já validado na raiz sob ambos os nomes, sem seguir esse redirect.
        const indexResponse = responses[0].clone();
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(
          responses.map((response, index) =>
            cache.put(SHELL_URLS[index], response),
          ),
        );
        await cache.put(INDEX_URL, indexResponse);
        await announceReady();
      } catch (error) {
        if (!alreadyExists) await caches.delete(CACHE_NAME);
        throw error;
      }
      // Atualizações aguardam confirmação da interface: sem skipWaiting aqui.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      // A última versão fica disponível como recuperação. Apenas a ativação
      // remove versões mais antigas; install nunca apaga o shell em uso.
      const previous = names
        .filter(
          (name) =>
            /^auto-ecu-lab-shell-v\d+$/.test(name) && name !== CACHE_NAME,
        )
        .filter(
          (name) =>
            Number(name.slice(CACHE_PREFIX.length + 1)) <
            Number(CACHE_VERSION.slice(1)),
        )
        .sort(
          (a, b) =>
            Number(b.slice(CACHE_PREFIX.length + 1)) -
            Number(a.slice(CACHE_PREFIX.length + 1)),
        )[0];
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(CACHE_PREFIX) &&
              name !== CACHE_NAME &&
              name !== previous,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
      await announceReady();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_WHEN_SAFE") {
    event.waitUntil(activateWhenSafe(event));
  }
  if (
    event.data?.type === "UPDATE_READY" ||
    event.data?.type === "UPDATE_BLOCKED"
  ) {
    const attempt = activation;
    if (
      attempt &&
      event.data.requestId === attempt.id &&
      attempt.clients.some((client) => client.id === event.source?.id)
    ) {
      if (event.data.type === "UPDATE_BLOCKED") {
        attempt.rejected = true;
        attempt.reasons = reasonsFrom(
          event.data,
          "Uma aba precisa concluir suas operações antes da atualização.",
        );
        attempt.resolve?.(false);
      } else if (!attempt.rejected) {
        attempt.acknowledgements.add(event.source.id);
        if (attempt.acknowledgements.size === attempt.clients.length)
          attempt.resolve?.(true);
      }
    }
  }
  if (event.data?.type === "SKIP_WAITING") {
    // Compatibilidade com o botão manual da versão 2. O controller novo nunca
    // envia esta mensagem: usa o acordo ACTIVATE_WHEN_SAFE entre todas as abas.
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === "CHECK_OFFLINE_READY") {
    event.waitUntil(
      isOfflineReady().then((ready) => {
        event.source?.postMessage({
          type: ready ? "OFFLINE_READY" : "OFFLINE_UNAVAILABLE",
          version: CACHE_VERSION,
        });
      }),
    );
  }
});

self.addEventListener("fetch", (event) => {
  // Login, autenticação, API, relatórios e conteúdo externo ficam fora do cache.
  if (!allowedRequest(event.request)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request.url);
      // Metadados públicos da versão podem ser consultados online sem servir
      // um release.json antigo. O fallback é o manifesto da instalação inteira.
      if (event.request.url === RELEASE_URL) {
        try {
          return await shellResponse(RELEASE_URL);
        } catch {
          if (cached) return cached;
        }
      }
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch (error) {
        if (event.request.mode === "navigate") {
          const fallback = await cache.match(INDEX_URL);
          if (fallback) return fallback;
        }
        return new Response(
          "AUTO ECU LAB ainda não está disponível sem internet. Conecte-se, abra o site e aguarde a confirmação de preparo offline.",
          {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
      }
    })(),
  );
});
