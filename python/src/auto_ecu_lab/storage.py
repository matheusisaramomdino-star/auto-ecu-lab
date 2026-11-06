"""Repositório SQLite local. Importações e anexos são gravados atomicamente."""
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

from .analysis import AnalysisConfig
from .models import DiagnosticCode, ECU, Sample, Vehicle


def vehicle_from_dict(data: dict) -> Vehicle:
    return Vehicle(**{**data, "ecu": ECU(**data.get("ecu", {}))})


class Repository:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1, 2):
                raise RuntimeError("Versão do banco não suportada; use uma versão compatível do aplicativo.")
            # DDL e cópia de segurança participam da mesma transação. Não usar
            # executescript: ele pode confirmar uma migração incompleta.
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("""CREATE TABLE IF NOT EXISTS vehicles (
                    id INTEGER PRIMARY KEY, payload TEXT NOT NULL
                )""")
            conn.execute("""CREATE TABLE IF NOT EXISTS recordings (
                    id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                    title TEXT NOT NULL, filename TEXT NOT NULL, created_at TEXT NOT NULL,
                    is_demo INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL,
                    samples TEXT NOT NULL, metadata TEXT NOT NULL,
                    analysis_config TEXT NOT NULL, diagnostics TEXT NOT NULL DEFAULT '[]'
                )""")
            for table in ("vehicles", "recordings"):
                columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
                if "archived" not in columns:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
            conn.execute("""CREATE TABLE IF NOT EXISTS demo_archive (
                recording_id INTEGER PRIMARY KEY REFERENCES recordings(id),
                archived_at TEXT NOT NULL, reason TEXT NOT NULL, payload TEXT NOT NULL
            )""")
            for row in conn.execute("SELECT * FROM recordings WHERE is_demo = 1 AND archived = 0").fetchall():
                self._archive_demo(conn, row)
            # Somente o cadastro exato usado pela antiga inicialização, sem
            # nenhum ensaio real associado, sai da lista. O original é mantido.
            for row in conn.execute("SELECT * FROM vehicles WHERE archived = 0").fetchall():
                vehicle = json.loads(row["payload"])
                ecu = vehicle.get("ecu", {})
                known_fields = ("manufacturer", "identification", "hardware", "software", "source")
                empty_ecu = (isinstance(ecu, dict)
                             and all(ecu.get(key, "") == "" for key in known_fields[:-1])
                             and ecu.get("source", "") in ("", "Não confirmada")
                             and all(key in known_fields or value == "" for key, value in ecu.items()))
                if empty_ecu and (vehicle.get("brand"), vehicle.get("model"), vehicle.get("year"), vehicle.get("engine"), vehicle.get("plate")) == ("Fiat", "Strada", 2022, "1.4", "DEMONSTRAÇÃO"):
                    counts = conn.execute("SELECT COUNT(*), SUM(CASE WHEN is_demo = 0 THEN 1 ELSE 0 END) FROM recordings WHERE vehicle_id = ?", (row["id"],)).fetchone()
                    if counts[0] and not counts[1]:
                        conn.execute("UPDATE vehicles SET archived = 1 WHERE id = ?", (row["id"],))
            conn.execute("PRAGMA user_version = 2")

    @staticmethod
    def _archive_demo(conn, row):
        vehicle = conn.execute("SELECT payload FROM vehicles WHERE id = ?", (row["vehicle_id"],)).fetchone()
        backup = {"recording": dict(row), "vehicle": json.loads(vehicle[0])}
        conn.execute("""INSERT OR IGNORE INTO demo_archive(recording_id, archived_at, reason, payload)
            VALUES (?, ?, ?, ?)""", (row["id"], datetime.now(timezone.utc).isoformat(),
                                      "Demonstração legada: excluída da base ativa; original preservado.", json.dumps(backup, ensure_ascii=False)))
        conn.execute("UPDATE recordings SET archived = 1 WHERE id = ?", (row["id"],))

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def add_vehicle(self, vehicle: Vehicle) -> int:
        vehicle.validate()
        with self.connect() as conn:
            return conn.execute("INSERT INTO vehicles(payload) VALUES (?)", (json.dumps(asdict(vehicle)),)).lastrowid

    def vehicles(self) -> list[dict]:
        with self.connect() as conn:
            return [{"id": r["id"], **json.loads(r["payload"])} for r in conn.execute("SELECT * FROM vehicles WHERE archived = 0 ORDER BY id DESC")]

    def vehicle(self, vehicle_id: int) -> Vehicle | None:
        with self.connect() as conn:
            row = conn.execute("SELECT payload FROM vehicles WHERE id = ? AND archived = 0", (vehicle_id,)).fetchone()
            return vehicle_from_dict(json.loads(row[0])) if row else None

    def add_recording(self, vehicle_id: int, title: str, filename: str, samples: list[Sample],
                      metadata: dict, is_demo: bool = False, diagnostics: list[DiagnosticCode] | None = None) -> int:
        # A identidade da ECU é preservada como estava no momento da importação.
        with self.connect() as conn:
            row = conn.execute("SELECT payload FROM vehicles WHERE id = ? AND archived = 0", (vehicle_id,)).fetchone()
            if row is None:
                raise LookupError("Veículo não encontrado.")
            recording_id = conn.execute("""INSERT INTO recordings
                (vehicle_id, title, filename, created_at, is_demo, snapshot, samples, metadata, analysis_config, diagnostics)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (
                    vehicle_id, title, filename, datetime.now(timezone.utc).isoformat(), int(is_demo), row[0],
                    json.dumps([asdict(s) for s in samples]), json.dumps(metadata), json.dumps(asdict(AnalysisConfig())),
                    json.dumps([asdict(d) for d in diagnostics or []]),
                )).lastrowid
            if is_demo:
                self._archive_demo(conn, conn.execute("SELECT * FROM recordings WHERE id = ?", (recording_id,)).fetchone())
            return recording_id

    def recordings(self) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute("SELECT id, title, filename, created_at, is_demo, snapshot FROM recordings WHERE archived = 0 AND is_demo = 0 ORDER BY id DESC")
            return [{**dict(r), "vehicle": json.loads(r["snapshot"])} for r in rows]

    def recording(self, recording_id: int) -> dict | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM recordings WHERE id = ? AND archived = 0 AND is_demo = 0", (recording_id,)).fetchone()
            if not row:
                return None
            result = dict(row)
            result["vehicle"] = vehicle_from_dict(json.loads(result.pop("snapshot")))
            result["samples"] = [Sample(**s) for s in json.loads(result["samples"])]
            result["metadata"] = json.loads(result["metadata"])
            result["diagnostics"] = [DiagnosticCode(**d) for d in json.loads(result["diagnostics"])]
            result["analysis_config"] = AnalysisConfig(**json.loads(result["analysis_config"]))
            return result

    def archive_backups(self) -> list[dict]:
        """Cópias locais para recuperação; nunca entram na interface ou nas estatísticas."""
        with self.connect() as conn:
            return [{**dict(row), "payload": json.loads(row["payload"])} for row in conn.execute("SELECT * FROM demo_archive ORDER BY recording_id")]

    def archive_count(self) -> int:
        with self.connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM demo_archive").fetchone()[0]

    def set_analysis_config(self, recording_id: int, config: AnalysisConfig):
        config.validate()
        with self.connect() as conn:
            conn.execute("UPDATE recordings SET analysis_config = ? WHERE id = ?", (json.dumps(asdict(config)), recording_id))

    def set_diagnostics(self, recording_id: int, codes: list[DiagnosticCode], provenance: dict):
        with self.connect() as conn:
            row = conn.execute("SELECT metadata FROM recordings WHERE id = ?", (recording_id,)).fetchone()
            if row is None:
                raise LookupError("Ensaio não encontrado.")
            metadata = {**json.loads(row[0]), "diagnostic_report": provenance}
            conn.execute("UPDATE recordings SET diagnostics = ?, metadata = ? WHERE id = ?",
                         (json.dumps([asdict(d) for d in codes]), json.dumps(metadata), recording_id))
