"""Pacote-fonte reproduzível, sem bancos locais, segredos ou caches."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "python"
DESTINATION = ROOT / "dist/downloads/AUTO_ECU_LAB_Python.zip"
EXCLUDED = {".git", ".venv", "__pycache__", ".pytest_cache", "instance", "build", "dist"}


def package():
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(DESTINATION, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(SOURCE.rglob("*")):
            relative = path.relative_to(SOURCE)
            if path.is_symlink() or not path.is_file():
                continue
            if any(part in EXCLUDED or part.endswith(".egg-info") for part in relative.parts):
                continue
            if path.suffix in {".pyc", ".pyo", ".sqlite", ".sqlite3", ".db", ".zip"} or path.name.startswith(".env"):
                continue
            info = zipfile.ZipInfo("AUTO_ECU_LAB/" + relative.as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
            count += 1
    print(f"Pacote-fonte Python: {count} arquivos; {DESTINATION.stat().st_size} bytes.")


if __name__ == "__main__":
    package()
