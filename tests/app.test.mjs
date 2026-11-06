import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
function runScenario(scenario) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (key.startsWith("NODE_TEST_")) delete environment[key];
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./support/app-dom-smoke.mjs", import.meta.url)),
      scenario,
    ],
    { encoding: "utf8", timeout: 10000, env: environment },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
test("aplicação inicia vazia, integra oito telas e não solicita hardware", () => {
  runScenario("empty");
});
test("atualização arquiva exemplo legado e mantém registro não verificado fora das estatísticas", () => {
  runScenario("legacy");
});
test("importação exige confirmação de origem, calcula hash e não duplica as estatísticas", () => {
  runScenario("import");
});
