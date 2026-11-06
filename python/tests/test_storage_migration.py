from dataclasses import asdict
import json
import sqlite3

import pytest

from auto_ecu_lab.analysis import AnalysisConfig
from auto_ecu_lab.models import ECU, Vehicle
from auto_ecu_lab.storage import Repository


def version_one(path):
    conn = sqlite3.connect(path)
    conn.executescript("""CREATE TABLE vehicles(id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE recordings(id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      title TEXT NOT NULL, filename TEXT NOT NULL, created_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0,
      snapshot TEXT NOT NULL, samples TEXT NOT NULL, metadata TEXT NOT NULL, analysis_config TEXT NOT NULL,
      diagnostics TEXT NOT NULL DEFAULT '[]'); PRAGMA user_version = 1;""")
    return conn


def insert_v1(conn, recording_id, vehicle_id, vehicle, demo):
    payload = json.dumps(asdict(vehicle))
    conn.execute("INSERT OR IGNORE INTO vehicles VALUES (?, ?)", (vehicle_id, payload))
    conn.execute("INSERT INTO recordings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (
        recording_id, vehicle_id, "Original \u00e7 " + str(recording_id), "original.csv", "2026-10-01T12:00:00Z", int(demo),
        payload, '[{"time_s":0,"pedal_pct":0,"throttle_pct":5,"rpm":850},{"time_s":1,"pedal_pct":50,"throttle_pct":40,"rpm":1800}]',
        '{"original": "preservar-exatamente", "sha256":"antigo"}', json.dumps(asdict(AnalysisConfig())), '[]'))
    conn.commit()


def test_new_database_schema_v2_has_no_records(tmp_path):
    repo = Repository(str(tmp_path / "new.sqlite3"))
    assert repo.vehicles() == repo.recordings() == repo.archive_backups() == []
    with repo.connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2


def test_v1_migration_archives_demo_and_preserves_real_rows_exactly(tmp_path):
    path = tmp_path / "old.sqlite3"
    conn = version_one(path)
    demo_vehicle = Vehicle("Fiat", "Strada", 2022, "1.4", "DEMONSTRAÇÃO")
    real_vehicle = Vehicle("Toyota", "Hilux", 2022, "2.8")
    insert_v1(conn, 1, 1, demo_vehicle, True)
    insert_v1(conn, 2, 2, real_vehicle, False)
    conn.row_factory = sqlite3.Row
    original_real = dict(conn.execute("SELECT * FROM recordings WHERE id=2").fetchone())
    original_demo = dict(conn.execute("SELECT * FROM recordings WHERE id=1").fetchone())
    conn.close()
    repo = Repository(str(path))
    assert [row["id"] for row in repo.recordings()] == [2]
    assert [row["id"] for row in repo.vehicles()] == [2]
    assert repo.recording(1) is None
    assert repo.recording(2)["metadata"]["original"] == "preservar-exatamente"
    backup = repo.archive_backups()[0]
    assert backup["payload"]["vehicle"]["plate"] == "DEMONSTRAÇÃO"
    for key, value in original_demo.items():
        assert backup["payload"]["recording"][key] == value
    with repo.connect() as conn:
        upgraded_real = dict(conn.execute("SELECT * FROM recordings WHERE id=2").fetchone())
        for key, value in original_real.items():
            assert upgraded_real[key] == value
        assert conn.execute("SELECT COUNT(*) FROM recordings").fetchone()[0] == 2
    assert len(Repository(str(path)).archive_backups()) == 1


def test_seed_vehicle_with_any_real_record_remains_visible(tmp_path):
    path = tmp_path / "shared.sqlite3"
    conn = version_one(path)
    vehicle = Vehicle("Fiat", "Strada", 2022, "1.4", "DEMONSTRAÇÃO")
    insert_v1(conn, 1, 1, vehicle, True)
    insert_v1(conn, 2, 1, vehicle, False)
    conn.close()
    repo = Repository(str(path))
    assert repo.vehicle(1) == vehicle
    assert len(repo.recordings()) == 1
    assert repo.recording(2) is not None


def test_seed_vehicle_that_received_ecu_identification_remains_visible(tmp_path):
    path = tmp_path / "identified.sqlite3"
    conn = version_one(path)
    vehicle = Vehicle("Fiat", "Strada", 2022, "1.4", "DEMONSTRAÇÃO", ECU(identification="Fixture da ECU cadastrada", source="Scanner informado"))
    insert_v1(conn, 1, 1, vehicle, True)
    conn.close()
    repo = Repository(str(path))
    assert repo.vehicle(1) == vehicle
    assert [row["id"] for row in repo.vehicles()] == [1]
    assert repo.recordings() == []
    assert repo.archive_count() == 1


def test_failed_migration_rolls_back_schema_backup_and_flags(tmp_path, monkeypatch):
    path = tmp_path / "rollback.sqlite3"
    conn = version_one(path)
    insert_v1(conn, 1, 1, Vehicle("Fiat", "Strada", 2022, "1.4"), True)
    conn.close()
    original = Repository._archive_demo
    def fail(conn, row):
        original(conn, row)
        raise RuntimeError("Falha simulada somente no teste")
    monkeypatch.setattr(Repository, "_archive_demo", staticmethod(fail))
    with pytest.raises(RuntimeError, match="Falha simulada"):
        Repository(str(path))
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
        assert "archived" not in [row[1] for row in conn.execute("PRAGMA table_info(recordings)")]
        assert not conn.execute("SELECT name FROM sqlite_master WHERE name='demo_archive'").fetchone()
        assert conn.execute("SELECT COUNT(*) FROM recordings").fetchone()[0] == 1
