"""Gera relatório legível e cópia offline a partir da auditoria versionada."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def build():
    audit = json.loads((ROOT / "docs/repository-audit.json").read_text())
    repositories = audit["repos"]
    if len(repositories) != 6 or len({item["name"] for item in repositories}) != 6:
        raise ValueError("A auditoria precisa conter os seis repositórios distintos.")
    for item in repositories:
        if not re.fullmatch(r"[0-9a-f]{40}", item["revision"]):
            raise ValueError("Revisão de auditoria inválida.")
        if not item["sourceLinks"] or not all(
            url.startswith("https://github.com/") and item["revision"] in url
            for url in item["sourceLinks"]
        ):
            raise ValueError("As fontes devem apontar para a revisão inspecionada.")
    parts = [(ROOT / "docs/module-plan-v23.md").read_text()]
    parts += [(ROOT / f"docs/audit-repos-{group}.md").read_text() for group in "ab"]
    report = "\n\n---\n\n".join(parts) + "\n"
    (ROOT / "docs/compatibility-report.md").write_text(report)
    module = "/** Auditoria estática versionada; não acessa repositórios nem hardware. */\n"
    module += "export const REPOSITORY_AUDIT = " + json.dumps(repositories, ensure_ascii=False, indent=2) + ";\n"
    module += "export const COMPATIBILITY_MARKDOWN = " + json.dumps(report, ensure_ascii=False) + ";\n"
    (ROOT / "dist/compatibility.mjs").write_text(module)
    print(f"Relatório e módulo offline gerados: {len(repositories)} repositórios.")


if __name__ == "__main__":
    build()
