import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { APP_VERSION } from "../dist/modules.mjs";
test("uma atualização mantém identidade, endereço inicial e escopo do aplicativo instalado", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../dist/manifest.webmanifest", import.meta.url)),
  );
  const release = JSON.parse(
    await readFile(new URL("../dist/release.json", import.meta.url)),
  );
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url)),
  );
  const lock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url)),
  );
  const sw = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8");
  const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.equal(manifest.id, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(release.version, APP_VERSION);
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(lock.version, APP_VERSION);
  assert.equal(lock.packages[""].version, APP_VERSION);
  assert.equal(release.cacheVersion, "v4");
  assert.equal(/const CACHE_VERSION\s*=\s*"([^"]+)"/.exec(sw)?.[1], release.cacheVersion);
  assert.equal(/id="app-version">v([^<]+)/.exec(index)?.[1], APP_VERSION);
  assert.ok(!manifest.start_url.includes(APP_VERSION));
});
