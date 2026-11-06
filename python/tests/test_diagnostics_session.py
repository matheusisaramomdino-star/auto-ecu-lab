import asyncio
import csv
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from auto_ecu_lab.diagnostics.__main__ import main, transport_for
from auto_ecu_lab.diagnostics.elm327 import ELM327Client, INITIALIZATION_COMMANDS
from auto_ecu_lab.diagnostics.errors import AmbiguousECUError, NoDataError, ProtocolError, ReadOnlyViolation, TransportError
from auto_ecu_lab.diagnostics.exports import live_csv
from auto_ecu_lab.diagnostics.registry import INTEGRATIONS
from auto_ecu_lab.diagnostics.transports import BleTransport, SerialTransport, WifiTransport


class ScriptedTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.writes = []
        self.chunks = []
        self.opened = self.closed = False

    async def open(self): self.opened = True
    async def close(self): self.closed = True
    async def write(self, data):
        self.writes.append(data)
        expected, reply = self.responses.pop(0)
        assert data == expected.encode() + b"\r"
        raw = reply.encode("ascii") + b">"
        self.chunks = [raw[i:i + 3] for i in range(0, len(raw), 3)]
    async def read(self):
        return self.chunks.pop(0) if self.chunks else b""


def initialized_script(extra):
    return [(command, "ELM327 v2.3" if command == "ATZ" else "OK") for command in INITIALIZATION_COMMANDS] + extra


def run(operation): return asyncio.run(operation)


def test_constructing_a_transport_or_session_does_not_connect():
    transport = ScriptedTransport([])
    client = ELM327Client(transport)
    assert not transport.opened and not client.connected
    assert SerialTransport("COM3")._serial is None
    assert WifiTransport("192.0.2.1", 35000)._writer is None


def test_query_binds_source_before_waiting_for_io():
    async def operation():
        client = ELM327Client(ScriptedTransport([]))
        client.initialized = True
        client.source = "7E8"
        async def exchange(_request):
            client.source = "7E9"  # Outra tarefa descobriu uma ECU durante o I/O.
            return "7E8 04 41 0C 1A F8"
        client._exchange = exchange
        assert await client.query("010C") == 1726
    run(operation())


def test_identification_and_dtc_keep_one_ecu_across_concurrent_discovery():
    async def operation():
        client = ELM327Client(ScriptedTransport([]))
        client.source = "7E8"
        origins = []
        async def query(request, source=None):
            origins.append(source)
            client.source = "7E9"
            if request == "0902": return "TESTE1234567890123"
            return []
        client.query = query
        identity = await client.identify()
        assert identity["source"] == "7E8"
        assert origins == ["7E8", "7E8", "7E8"]
        origins.clear(); client.source = "7E8"
        result = await client.read_diagnostics()
        assert result["source"] == "7E8"
        assert origins == ["7E8", "7E8", "7E8"]
    run(operation())


def test_session_frames_chunks_and_blocks_writes_before_io():
    async def operation():
        transport = ScriptedTransport(initialized_script([("010C", "7E8 04 41 0C 1A F8")]))
        client = ELM327Client(transport)
        with pytest.raises(ReadOnlyViolation): await client.query("04")
        assert not transport.writes
        await client.connect()
        await client.initialize()
        assert await client.query("010C") == 1726
        with pytest.raises(ReadOnlyViolation): await client.query("ATSH7E0")
        assert transport.writes[-1] == b"010C\r"
        await client.disconnect()
        assert transport.closed and not client.initialized
    run(operation())


def test_bad_adapter_identification_stops_before_vehicle_requests():
    async def operation():
        transport = ScriptedTransport([("ATZ", "UNKNOWN DEVICE")])
        client = ELM327Client(transport)
        await client.connect()
        with pytest.raises(ProtocolError): await client.initialize()
        assert transport.writes == [b"ATZ\r"]
        assert transport.closed
    run(operation())


def test_discovery_never_chooses_the_first_of_multiple_ecus():
    async def operation():
        transport = ScriptedTransport(initialized_script([("0100", "7E8 06 41 00 00 10 00 00\r7E9 06 41 00 00 10 00 00")]))
        client = ELM327Client(transport)
        await client.connect(); await client.initialize()
        with pytest.raises(AmbiguousECUError): await client.discover()
        assert client.source is None
    run(operation())


def test_unsupported_pedal_stays_absent_and_is_not_queried_or_simulated():
    async def operation():
        transport = ScriptedTransport(initialized_script([
            ("0100", "7E8 06 41 00 00 10 80 00"),
            ("010C", "7E8 04 41 0C 1A F8"),
            ("0111", "7E8 03 41 11 80"),
        ]))
        client = ELM327Client(transport)
        await client.connect(); await client.initialize(); await client.discover("7E8")
        reading = await client.read_live()
        assert reading.pedal_pct is None and reading.rpm == 1726
        assert reading.source == "7E8" and reading.mode == "real_read_only"
        assert "pedal_pct" in reading.errors
        assert "pedal_pct" not in reading.channel_times_s
        assert b"0149\r" not in transport.writes
    run(operation())


def test_no_data_is_preserved_without_substituting_zero():
    async def operation():
        transport = ScriptedTransport(initialized_script([
            ("0100", "7E8 06 41 00 00 10 00 00"), ("010C", "NO DATA")]))
        client = ELM327Client(transport)
        await client.connect(); await client.initialize(); await client.discover()
        reading = await client.read_live()
        assert reading.rpm is None and "NO DATA" in reading.errors["rpm"]
        assert client.connected  # timeout/incomplete framing has a different outcome
    run(operation())


def test_supported_pid_pages_are_read_until_the_needed_page():
    async def operation():
        transport = ScriptedTransport(initialized_script([
            ("0100", "7E8 06 41 00 00 10 80 01"),
            ("0120", "7E8 06 41 20 00 00 00 01"),
            ("0140", "7E8 06 41 40 00 80 00 00"),
        ]))
        client = ELM327Client(transport)
        await client.connect(); await client.initialize()
        result = await client.discover()
        assert "49" in result["supported_pids"]
        assert result["source"] == "7E8"
    run(operation())


def test_timeout_closes_session_so_a_late_response_cannot_be_reused():
    async def operation():
        transport = ScriptedTransport(initialized_script([]))
        client = ELM327Client(transport, timeout=0.1)
        await client.connect(); await client.initialize()
        transport.write = AsyncMock()
        async def silence():
            await asyncio.sleep(10)
        transport.read = silence
        with pytest.raises(TransportError, match="Sessão encerrada"):
            await client.query("010C")
        assert not client.connected and transport.closed
    run(operation())


def test_dtc_no_data_is_not_an_empty_dtc_list():
    async def operation():
        transport = ScriptedTransport(initialized_script([
            ("0100", "7E8 06 41 00 00 10 00 00"),
            ("03", "NO DATA"), ("07", "7E8 02 47 00"), ("0A", "7E8 02 4A 00")]))
        client = ELM327Client(transport)
        await client.connect(); await client.initialize(); await client.discover()
        result = await client.read_diagnostics()
        assert result["stored"] is None
        assert result["pending"] == result["permanent"] == []
        assert "stored" in result["errors"]
    run(operation())


def test_live_export_preserves_missing_values_origin_and_channel_timestamps():
    data = [{"time_s": 1, "source": "7E8", "pedal_pct": None, "throttle_pct": 20, "rpm": 900,
             "channel_times_s": {"rpm": 1.1, "throttle_pct": 1.2}, "errors": {"pedal_pct": "PID não suportado"}}]
    rows = list(csv.DictReader(io.StringIO(live_csv(data)), delimiter=";"))
    assert rows[0]["pedal_pct"] == ""
    assert rows[0]["ecu_origem"] == "7E8"
    assert rows[0]["tempo_rpm_s"] == "1.1"
    assert "PID não suportado" in rows[0]["observacoes"]
    assert rows[0]["modo"] == "real_read_only"


def test_cli_without_read_action_never_opens_a_device(monkeypatch, capsys):
    monkeypatch.setattr("auto_ecu_lab.diagnostics.__main__.transport_for", lambda _args: pytest.fail("conexão não solicitada"))
    assert main([]) == 0
    assert main(["integrations"]) == 0
    assert "aguardando_integração_autorizada" in capsys.readouterr().out


@pytest.mark.parametrize("kind", ["serial", "wifi", "ble"])
def test_transports_do_not_guess_missing_endpoints_or_uuids(kind):
    with pytest.raises(ValueError):
        transport_for(SimpleNamespace(transport=kind, device=None, host=None, port=None,
                                      service_uuid=None, rx_uuid=None, tx_uuid=None))


def test_ble_requires_vendor_uuids_and_tcp_serial_validate_configuration():
    with pytest.raises(ValueError): BleTransport("device", "invalid", "invalid", "invalid")
    with pytest.raises(ValueError): WifiTransport("host", 0)
    with pytest.raises(ValueError): SerialTransport("COM3", baudrate=0)
    with pytest.raises(ValueError): ELM327Client(ScriptedTransport([]), timeout=float("nan"))


def test_proprietary_scanners_are_explicitly_not_implemented():
    registry = {integration.id: integration for integration in INTEGRATIONS}
    assert registry["rasther_iii_s"].status == "aguardando_integração_autorizada"
    assert registry["j2534"].status == "aguardando_driver_e_integração"
    assert all(not integration.hardware_verified for integration in INTEGRATIONS)
