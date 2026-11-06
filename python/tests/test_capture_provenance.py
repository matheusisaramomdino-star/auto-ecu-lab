"""Capturas inteiramente em memória; nenhum scanner ou veículo é acessado."""
from datetime import datetime
import hashlib
import json
from types import SimpleNamespace
from uuid import UUID

import pytest

from auto_ecu_lab.diagnostics import __main__ as cli
from auto_ecu_lab.diagnostics.errors import TransportError


class CapturedClient:
    failure = None

    def __init__(self, _transport, timeout):
        self.connected = False
        self.cycles = 0

    async def connect(self):
        if self.failure == "connect":
            raise TransportError("Falha de conexão de teste.")
        self.connected = True

    async def initialize(self):
        if self.failure == "initialize":
            raise TransportError("Adaptador não identificado no teste.")

    async def discover(self, _requested_ecu):
        if self.failure == "discover":
            raise TransportError("Nenhuma ECU respondeu no teste.")
        return {"source": "7E8", "supported_pids": ["0C", "11", "49"]}

    async def identify(self):
        return {"source": "7E8", "vin": None, "calibration_ids": [], "cvns": [], "errors": {}}

    async def read_diagnostics(self):
        return {"source": "7E8", "stored": [], "pending": [], "permanent": [], "errors": {}}

    async def read_live(self):
        self.cycles += 1
        if self.failure == "partial" and self.cycles > 1:
            raise TransportError("Queda de transporte após uma leitura de teste.")
        return SimpleNamespace(as_record=lambda: {
            "time_s": 0.1, "source": "7E8", "pedal_pct": None, "throttle_pct": 20.0,
            "rpm": 900.0, "channel_times_s": {"rpm": 0.11, "throttle_pct": 0.12},
            "errors": {"pedal_pct": "PID indisponível no ensaio de teste."}, "mode": "real_read_only",
        })

    async def disconnect(self):
        self.connected = False


def capture(monkeypatch, tmp_path, failure=None):
    class Client(CapturedClient):
        pass
    Client.failure = failure
    monkeypatch.setattr(cli, "ELM327Client", Client)
    monkeypatch.setattr(cli, "transport_for", lambda _args: object())
    output = tmp_path / "captura.csv"
    status = cli.main(["read", "--transport", "serial", "--device", "TESTE",
                       "--ecu", "7E9", "--duration", "1" if failure == "partial" else "0",
                       "--interval", "0.05", "--output", str(output)])
    return status, output, json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))


def test_capture_provenance_hashes_exact_export_and_preserves_protocol_origin(monkeypatch, tmp_path):
    status, output, report = capture(monkeypatch, tmp_path)
    metadata = report["metadata"]
    provenance = metadata["provenance"]
    assert status == 0
    assert report["mode"] == "real_read_only" and report["is_demo"] is False
    assert metadata["operation_mode"] == "real"
    assert str(UUID(metadata["capture_id"])) == metadata["capture_id"]
    assert metadata["connection"]["adapter"] == "ELM327"
    assert metadata["connection"]["transport"] == "serial"
    assert metadata["connection"]["ecuId"] == metadata["identity"]["ecuId"] == "7E8"
    assert metadata["connection"]["started_at"] == metadata["connection"]["started_at_utc"]
    assert datetime.fromisoformat(metadata["connection"]["started_at"]).utcoffset() is not None
    assert provenance == {
        "schema_version": 1, "kind": "scanner_capture", "source": "ELM327 · aquisição OBD-II somente leitura",
        "captured_at": metadata["connection"]["started_at"], "verification": "protocol_capture",
        "reference": metadata["capture_id"], "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    }
    assert output.read_bytes().startswith(b"\xef\xbb\xbf")
    assert report["readings"][0]["pedal_pct"] is None
    assert report["identification"]["vin"] is None
    assert metadata["signal_definitions"] == {
        "time_s": "monotonic_seconds",
        "throttle_pct": "OBD-II 01 11 percent",
        "rpm": "OBD-II 01 0C rpm",
    }


@pytest.mark.parametrize("failure", ["connect", "initialize", "discover"])
def test_failed_capture_does_not_promote_requested_ecu_to_received_identity(monkeypatch, tmp_path, failure):
    status, _output, report = capture(monkeypatch, tmp_path, failure)
    metadata = report["metadata"]
    assert status == 1
    assert report["errors"] and report["readings"] == []
    assert metadata["provenance"] is None
    assert metadata["signal_definitions"] == {}
    assert "ecuId" not in metadata["connection"] and "ecuId" not in metadata["identity"]
    if failure == "connect":
        assert "started_at" not in metadata["connection"]
    if failure in ("connect", "initialize"):
        assert "adapter" not in metadata["connection"]


def test_partial_capture_keeps_only_observed_values_and_hashes_partial_csv(monkeypatch, tmp_path):
    status, output, report = capture(monkeypatch, tmp_path, "partial")
    assert status == 1 and len(report["readings"]) == 1
    assert report["readings"][0]["pedal_pct"] is None
    assert report["metadata"]["provenance"]["sha256"] == hashlib.sha256(output.read_bytes()).hexdigest()
    assert "Queda de transporte" in report["errors"][0]
