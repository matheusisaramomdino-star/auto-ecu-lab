/** Contratos de publicação para manter versão, cache e módulos consistentes. */
import { readFile, readdir } from "node:fs/promises";
import { APP_VERSION } from "../dist/modules.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const release = JSON.parse(
  await readFile(new URL("dist/release.json", root), "utf8"),
);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
const sw = await readFile(new URL("dist/sw.js", root), "utf8");
const index = await readFile(new URL("dist/index.html", root), "utf8");
const cache = /const CACHE_VERSION\s*=\s*["']([^"']+)/.exec(sw)?.[1];
if (
  release.version !== APP_VERSION ||
  pkg.version !== APP_VERSION ||
  lock.version !== APP_VERSION ||
  lock.packages?.[""]?.version !== APP_VERSION ||
  /id="app-version">v([^<]+)/.exec(index)?.[1] !== APP_VERSION ||
  cache !== release.cacheVersion
)
  throw new Error(
    "Versão do produto, manifesto e cache divergem. Atualize os metadados antes de publicar.",
  );
for (const file of await readdir(new URL("dist/", root))) {
  if (
    file.endsWith(".mjs") &&
    !sw.includes('"./' + file + '"') &&
    !sw.includes("'./" + file + "'")
  )
    throw new Error("Módulo ausente do preparo offline: " + file);
}
if (!sw.includes("release.json"))
  throw new Error("O manifesto de atualização deve acompanhar o app offline.");
let previousSw = null,
  changed = [];
try {
  const cwd = fileURLToPath(root),
    git = (args) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
  previousSw = git(["show", "HEAD:dist/sw.js"]);
  changed = [
    ...git(["diff", "--name-only", "HEAD", "--", "dist"]).split("\n"),
    ...git(["ls-files", "--others", "--exclude-standard", "--", "dist"]).split(
      "\n",
    ),
  ].filter((path) => path && !path.startsWith("dist/downloads/"));
} catch {
  /* Pacotes de fonte sem histórico Git conservam a verificação estática. */
}
if (previousSw && changed.length) {
  const previousCache = /const CACHE_VERSION\s*=\s*["']([^"']+)/.exec(
    previousSw,
  )?.[1];
  if (previousCache === cache)
    throw new Error(
      "O shell mudou sem trocar sua geração de cache. Avance CACHE_VERSION e release.cacheVersion para distribuir a melhoria aos apps instalados.",
    );
}
console.log(
  `Publicação coerente: AUTO ECU LAB ${APP_VERSION}, cache ${cache}.`,
);
