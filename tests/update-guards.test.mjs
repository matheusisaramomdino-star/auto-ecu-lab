import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { formFingerprint, updateSafety } from "../dist/modules.mjs";

test("campos e arquivos pendentes são detectados sem enviar seu conteúdo", () => {
  const { document } = parseHTML(
    '<form><input name="model" value="Strada"><input name="file" type="file"></form>',
  );
  const form = document.querySelector("form"),
    baseline = formFingerprint(form);
  form.querySelector("[name=model]").value = "Hilux";
  assert.notEqual(formFingerprint(form), baseline);
  form.querySelector("[name=model]").value = "Strada";
  assert.equal(formFingerprint(form), baseline);
  form.querySelector("[type=file]").files = [
    { name: "relatorio.csv", size: 40, lastModified: 1 },
  ];
  assert.notEqual(formFingerprint(form), baseline);
});
test("atualização só é segura quando não há operação ou rascunho pendente", () => {
  assert.deepEqual(updateSafety(), { safe: true, reasons: [] });
  for (const flag of [
    "writing",
    "preferencesWriting",
    "session",
    "collecting",
    "hardwareBusy",
    "unsavedSession",
    "dirtyForms",
  ]) {
    const result = updateSafety({ [flag]: true });
    assert.equal(result.safe, false, flag);
    assert.ok(result.reasons.length);
  }
  assert.equal(
    updateSafety({ writing: true, session: true, dirtyForms: true }).reasons
      .length,
    3,
  );
});
