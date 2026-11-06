"""Sessão real ELM327: fila serial de consultas, sem caminhos de programação."""
import asyncio
from dataclasses import asdict, dataclass, field
import math
import time

from .errors import DiagnosticsError, NoDataError, ProtocolError, TransportError
from .obd import decode_response, parse_elm_response, select_message, validate_request
from .transports import Transport

INITIALIZATION_COMMANDS = ("ATZ", "ATE0", "ATL0", "ATS1", "ATH1", "ATCAF1", "ATCFC1", "ATSP0")
METRICS = {"rpm": 0x0C, "throttle_pct": 0x11, "pedal_pct": 0x49}


@dataclass(frozen=True)
class LiveReading:
    time_s: float
    source: str
    pedal_pct: float | None
    throttle_pct: float | None
    rpm: float | None
    channel_times_s: dict[str, float] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)
    mode: str = "real_read_only"

    def as_record(self) -> dict:
        return asdict(self)


class ELM327Client:
    def __init__(self, transport: Transport, timeout: float = 5):
        if not math.isfinite(timeout) or not 0.1 <= timeout <= 60:
            raise ValueError("Timeout deve estar entre 0,1 e 60 segundos.")
        self.transport, self.timeout = transport, timeout
        self.connected = False
        self.initialized = False
        self.source: str | None = None
        self.supported: frozenset[int] = frozenset()
        self._lock = asyncio.Lock()
        self._start = None

    async def connect(self):
        if self.connected:
            raise TransportError("A sessão já está conectada.")
        try:
            await asyncio.wait_for(self.transport.open(), self.timeout)
        except TimeoutError as exc:
            try:
                await self.transport.close()
            except Exception:
                pass
            raise TransportError("Tempo esgotado ao conectar ao adaptador.") from exc
        self.connected = True
        self._start = time.monotonic()

    async def disconnect(self):
        self.connected = self.initialized = False
        self.source, self.supported = None, frozenset()
        await self.transport.close()

    async def _exchange(self, command: str) -> str:
        if not self.connected:
            raise TransportError("Conecte o adaptador antes de consultar.")
        async with self._lock:
            if not self.connected:
                raise TransportError("A sessão foi encerrada antes de enviar esta consulta.")
            async def conversation():
                await self.transport.write(command.encode("ascii") + b"\r")
                buffer = bytearray()
                while b">" not in buffer:
                    part = await self.transport.read()
                    if not isinstance(part, bytes):
                        raise TransportError("O transporte deve retornar bytes.")
                    buffer.extend(part)
                    if len(buffer) > 65536:
                        raise ProtocolError("A resposta excedeu o limite de 64 KiB e foi rejeitada.")
                    if not part:
                        await asyncio.sleep(0.005)
                response, extra = bytes(buffer).split(b">", 1)
                if extra.strip(b" \r\n"):
                    raise ProtocolError("Resposta extra sem solicitação; a sessão precisa ser reconectada.")
                try:
                    return response.decode("ascii")
                except UnicodeDecodeError as exc:
                    raise ProtocolError("O adaptador não respondeu no protocolo ASCII documentado.") from exc
            try:
                return await asyncio.wait_for(conversation(), self.timeout)
            except TimeoutError as exc:
                # Após timeout não é seguro atribuir uma resposta tardia à próxima consulta.
                try:
                    await self.disconnect()
                except Exception:
                    pass
                raise TransportError(f"Tempo esgotado na consulta {command}. Sessão encerrada para evitar dados de outra solicitação.") from exc
            except (ProtocolError, TransportError):
                try:
                    await self.disconnect()
                except Exception:
                    pass
                raise

    async def initialize(self):
        if not self.connected:
            raise TransportError("Conecte o adaptador antes de inicializar.")
        for command in INITIALIZATION_COMMANDS:
            result = await self._exchange(command)
            lines = [line.strip().upper() for line in result.replace("\r", "\n").splitlines() if line.strip()]
            lines = [line for line in lines if line.replace(" ", "") != command]
            if command == "ATZ":
                if not lines or not any("ELM327" in line for line in lines):
                    await self.disconnect()
                    raise ProtocolError("O dispositivo não se identificou como ELM327. Não foi aberto um console genérico.")
            elif lines != ["OK"]:
                await self.disconnect()
                raise ProtocolError(f"O adaptador não confirmou {command}; a inicialização foi interrompida.")
        self.initialized = True

    async def query(self, request: str, source: str | None = None):
        # Validar antes de qualquer I/O, inclusive quando a sessão está fechada.
        request = validate_request(request)
        if not self.initialized:
            raise TransportError("Inicialize uma sessão ELM327 antes das consultas OBD-II.")
        selected_source = source or self.source
        messages = parse_elm_response(await self._exchange(request), request)
        return decode_response(select_message(messages, selected_source), request)

    async def discover(self, source: str | None = None) -> dict:
        if not self.initialized:
            raise TransportError("Inicialize o adaptador antes de descobrir PIDs.")
        messages = parse_elm_response(await self._exchange("0100"), "0100")
        selected = select_message(messages, source)
        available = decode_response(selected, "0100")
        selected_source = selected.source
        combined = set(available)
        page = 0x20
        while page <= 0xE0 and page in combined:
            # A seleção é explícita em todas as consultas, nunca une ECUs.
            values = await self.query(f"01{page:02X}", selected_source)
            combined.update(values)
            page += 0x20
        self.source, self.supported = selected_source, frozenset(combined)
        return {"source": self.source, "responding_sources": [message.source for message in messages],
                "supported_pids": [f"{pid:02X}" for pid in sorted(combined)], "mode": "real_read_only"}

    async def identify(self) -> dict:
        if not self.source:
            raise ProtocolError("Selecione a ECU com discover antes de identificar.")
        source = self.source
        result = {"source": source, "vin": None, "calibration_ids": [], "cvns": [], "errors": {},
                  "note": "VIN/CALID/CVN não confirmam automaticamente família, fabricante ou HW da ECU."}
        for request, name in (("0902", "vin"), ("0904", "calibration_ids"), ("0906", "cvns")):
            try:
                result[name] = await self.query(request, source)
            except DiagnosticsError as exc:
                result["errors"][name] = str(exc)
                if not self.connected:
                    break
        return result

    async def read_diagnostics(self) -> dict:
        if not self.source:
            raise ProtocolError("Selecione a ECU antes de ler DTCs.")
        source = self.source
        result = {"source": source, "stored": None, "pending": None, "permanent": None, "errors": {}}
        for request, name in (("03", "stored"), ("07", "pending"), ("0A", "permanent")):
            try:
                result[name] = await self.query(request, source)
            except DiagnosticsError as exc:
                result["errors"][name] = str(exc)
                if not self.connected:
                    break
        return result

    async def read_live(self) -> LiveReading:
        if not self.source or self._start is None:
            raise ProtocolError("Selecione a ECU antes de adquirir sinais.")
        source = self.source
        supported = self.supported
        timestamp = time.monotonic() - self._start
        values = {name: None for name in METRICS}
        channel_times = {}
        errors = {}
        for name, pid in METRICS.items():
            if pid not in supported:
                errors[name] = f"PID {pid:02X} não foi anunciado pela ECU {source}; valor ausente, sem substituição por zero."
                continue
            try:
                values[name] = await self.query(f"01{pid:02X}", source)
                channel_times[name] = time.monotonic() - self._start
            except DiagnosticsError as exc:
                errors[name] = str(exc)
                if not self.connected:
                    break
        return LiveReading(timestamp, source, values["pedal_pct"], values["throttle_pct"], values["rpm"], channel_times, errors)
