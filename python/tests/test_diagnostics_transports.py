import asyncio
import sys
from types import SimpleNamespace

import pytest

from auto_ecu_lab.diagnostics.errors import TransportError
from auto_ecu_lab.diagnostics.transports import BleTransport, SerialTransport, WifiTransport

SERVICE = "00000001-0000-1000-8000-00805f9b34fb"
RX = "00000002-0000-1000-8000-00805f9b34fb"
TX = "00000003-0000-1000-8000-00805f9b34fb"


def test_serial_transport_uses_only_explicit_port_and_handles_disconnection(monkeypatch):
    instances = []
    class Port:
        def __init__(self, **kwargs):
            self.kwargs, self.writes, self.closed = kwargs, [], False
            instances.append(self)
        def write(self, data): self.writes.append(data); return len(data)
        def read(self, count):
            if self.closed: raise OSError("desconectado")
            return b"OK\r>"
        def close(self): self.closed = True
    monkeypatch.setitem(sys.modules, "serial", SimpleNamespace(Serial=Port))
    async def operation():
        transport = SerialTransport("COM7", baudrate=115200)
        await transport.open(); await transport.write(b"010C\r")
        assert await transport.read() == b"OK\r>"
        assert instances[0].kwargs["port"] == "COM7"
        assert instances[0].kwargs["baudrate"] == 115200
        instances[0].closed = True
        with pytest.raises(TransportError): await transport.read()
        await transport.close()
        assert transport._serial is None
    asyncio.run(operation())


def test_tcp_transport_framing_and_eof_without_network(monkeypatch):
    recorded = []
    class Reader:
        values = [b"41 0C", b""]
        async def read(self, _count): return self.values.pop(0)
    class Writer:
        closed = False
        def write(self, value): recorded.append(value)
        async def drain(self): pass
        def close(self): self.closed = True
        async def wait_closed(self): pass
    writer = Writer()
    async def connect(host, port):
        assert (host, port) == ("192.0.2.5", 12345)
        return Reader(), writer
    monkeypatch.setattr(asyncio, "open_connection", connect)
    async def operation():
        transport = WifiTransport("192.0.2.5", 12345)
        await transport.open(); await transport.write(b"010C\r")
        assert await transport.read() == b"41 0C"
        with pytest.raises(TransportError, match="encerrou"): await transport.read()
        await transport.close()
        assert recorded == [b"010C\r"] and writer.closed
    asyncio.run(operation())


def test_ble_service_characteristics_notifications_and_writes_are_checked(monkeypatch):
    instances = []
    class Client:
        def __init__(self, address, timeout):
            self.address, self.is_connected, self.writes = address, False, []
            rx, tx = SimpleNamespace(properties=["notify"]), SimpleNamespace(properties=["write"])
            service = SimpleNamespace(get_characteristic=lambda uuid: {RX: rx, TX: tx}.get(uuid))
            self.services = SimpleNamespace(get_service=lambda uuid: service if uuid == SERVICE else None)
            instances.append(self)
        async def connect(self): self.is_connected = True
        async def disconnect(self): self.is_connected = False
        async def start_notify(self, rx, callback): self.callback = callback
        async def stop_notify(self, uuid): pass
        async def write_gatt_char(self, uuid, data, response): self.writes.append((uuid, data, response))
    monkeypatch.setitem(sys.modules, "bleak", SimpleNamespace(BleakClient=Client))
    async def operation():
        transport = BleTransport("endereco-documentado", SERVICE, RX, TX)
        await transport.open()
        instances[0].callback(None, bytearray(b"OK>"))
        assert await transport.read() == b"OK>"
        await transport.write(b"010C\r")
        assert instances[0].writes == [(TX, b"010C\r", True)]
        for _ in range(257): instances[0].callback(None, b"x")
        with pytest.raises(TransportError, match="buffer"): await transport.read()
        await transport.close()
        assert not instances[0].is_connected
    asyncio.run(operation())


def test_ble_invalid_service_disconnects_instead_of_guessing_another_profile(monkeypatch):
    clients = []
    class Client:
        def __init__(self, *_args, **_kwargs):
            self.services = SimpleNamespace(get_service=lambda _: None)
            self.closed = False; clients.append(self)
        async def connect(self): pass
        async def disconnect(self): self.closed = True
    monkeypatch.setitem(sys.modules, "bleak", SimpleNamespace(BleakClient=Client))
    async def operation():
        transport = BleTransport("device", SERVICE, RX, TX)
        with pytest.raises(TransportError, match="Serviço"): await transport.open()
        assert clients[0].closed
    asyncio.run(operation())
