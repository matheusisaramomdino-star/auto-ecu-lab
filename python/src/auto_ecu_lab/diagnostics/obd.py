"""Decodificador de consultas OBD-II de leitura, sem comando arbitrário.

Suporta CAN 11/29 bits com cabeçalhos e ISO-TP. Não adivinha cabeçalhos ISO
9141/J1850/KWP nem mistura os dados de ECUs diferentes.
"""
from dataclasses import dataclass
import re

from .errors import AmbiguousECUError, NegativeResponseError, NoDataError, ProtocolError, ReadOnlyViolation

SUPPORTED_PAGES = frozenset(range(0, 0x100, 0x20))
LIVE_PIDS = frozenset({0x0C, 0x11, 0x49})
MODE9_PIDS = frozenset({0x00, 0x02, 0x04, 0x06})
DTC_SERVICES = frozenset({0x03, 0x07, 0x0A})
NO_HEADER = "SEM_CABECALHO"


@dataclass(frozen=True)
class Message:
    source: str
    payload: bytes
    can: bool = True


def validate_request(request: str) -> str:
    if not isinstance(request, str):
        raise ReadOnlyViolation("A consulta OBD-II deve ser texto hexadecimal.")
    request = re.sub(r"[ \t]", "", request).upper()
    # CR/LF não são removidos: impedem injeção de um segundo comando.
    if not re.fullmatch(r"(?:[0-9A-F]{2}){1,2}", request):
        raise ReadOnlyViolation("Consulta não autorizada. Não existe console de comandos arbitrários.")
    data = bytes.fromhex(request)
    service = data[0]
    allowed = (service == 1 and len(data) == 2 and data[1] in SUPPORTED_PAGES | LIVE_PIDS)
    allowed |= service == 9 and len(data) == 2 and data[1] in MODE9_PIDS
    allowed |= service in DTC_SERVICES and len(data) == 1
    if not allowed:
        raise ReadOnlyViolation("Somente consultas OBD-II de leitura documentadas são permitidas; apagar DTC, atuar ou programar está bloqueado.")
    return request


def _frame(line: str, headerless_can: bool) -> tuple[str, bytes, bool]:
    tokens = line.split()
    source = None
    if tokens and re.fullmatch(r"[0-9A-F]{3}", tokens[0]) and int(tokens[0], 16) <= 0x7FF:
        source, tokens = tokens[0], tokens[1:]
    elif tokens and re.fullmatch(r"[0-9A-F]{8}", tokens[0]) and int(tokens[0], 16) <= 0x1FFFFFFF:
        source, tokens = tokens[0], tokens[1:]
    elif len(tokens) >= 5 and tokens[:3] in (["18", "DA", "F1"], ["18", "DB", "33"]):
        source, tokens = "".join(tokens[:4]), tokens[4:]
    elif len(tokens) == 1:
        compact = tokens[0]
        if len(compact) >= 7 and len(compact) % 2 and re.fullmatch(r"[0-9A-F]+", compact):
            source, tokens = compact[:3], [compact[3:]]
            if int(source, 16) > 0x7FF:
                raise ProtocolError("Cabeçalho CAN de 11 bits inválido.")
        elif len(compact) >= 12 and compact.startswith(("18DA", "18DB")):
            source, tokens = compact[:8], [compact[8:]]
    # ATD1 pode acrescentar DLC de um dígito. Não confundir com PCI 02/03.
    if source is not None and tokens and re.fullmatch(r"[0-8]", tokens[0]):
        dlc, tokens = int(tokens[0]), tokens[1:]
        if len("".join(tokens)) != dlc * 2:
            raise ProtocolError(f"ECU {source}: DLC e tamanho do quadro não coincidem.")
    raw = "".join(tokens)
    if not re.fullmatch(r"(?:[0-9A-F]{2})+", raw):
        raise ProtocolError("Resposta fora do formato CAN documentado; não foi interpretada como dado válido.")
    data = bytes.fromhex(raw)
    if source is None:
        if not headerless_can:
            raise ProtocolError("Resposta sem identificação de ECU. Ative ATH1; protocolos legados exigem adaptador específico.")
        return NO_HEADER, data, False
    if not data or len(data) > 8:
        raise ProtocolError(f"ECU {source}: quadro CAN deve ter de 1 a 8 bytes.")
    return source, data, True


def parse_elm_response(text: str, request: str, *, headerless_can: bool = False) -> list[Message]:
    request = validate_request(request)
    frames = []
    for original in re.split(r"[\r\n]+", text.replace(">", "")):
        line = original.strip().upper()
        if not line or re.sub(r"[ \t]", "", line) == request:
            continue
        if line in {"SEARCHING...", "BUS INIT: OK", "BUS INIT: ...OK"}:
            continue
        if line == "NO DATA":
            raise NoDataError(f"Consulta {request}: o scanner respondeu NO DATA; não equivale a zero nem a ausência de DTC.")
        if any(marker in line for marker in ("UNABLE TO CONNECT", "BUS ERROR", "CAN ERROR", "STOPPED", "BUFFER FULL", "DATA ERROR", "BUS INIT: ERROR")) or line == "?":
            raise ProtocolError(f"Consulta {request}: scanner informou {line}.")
        frames.append(_frame(line, headerless_can))
    if not frames:
        raise NoDataError(f"Consulta {request}: resposta vazia.")
    messages = []
    pending: dict[str, dict] = {}
    for source, data, has_header in frames:
        if not has_header:
            if any(message.source == source for message in messages):
                raise AmbiguousECUError("Múltiplas respostas sem cabeçalho não podem ser atribuídas à mesma ECU com segurança.")
            messages.append(Message(source, data, True))
            continue
        kind = data[0] >> 4
        if kind == 0:
            count = data[0] & 15
            if not 1 <= count <= 7 or len(data) < count + 1 or source in pending:
                raise ProtocolError(f"ECU {source}: quadro ISO-TP único truncado ou fora de sequência.")
            messages.append(Message(source, data[1:count + 1]))
        elif kind == 1:
            if len(data) != 8 or source in pending:
                raise ProtocolError(f"ECU {source}: primeiro quadro ISO-TP inválido.")
            total = ((data[0] & 15) << 8) | data[1]
            if not 8 <= total <= 4095:
                raise ProtocolError(f"ECU {source}: comprimento ISO-TP inválido.")
            pending[source] = {"size": total, "data": bytearray(data[2:]), "sequence": 1}
        elif kind == 2:
            progress = pending.get(source)
            if progress is None or len(data) < 2 or data[0] & 15 != progress["sequence"]:
                raise ProtocolError(f"ECU {source}: quadro consecutivo ISO-TP fora de sequência.")
            remaining = progress["size"] - len(progress["data"])
            if len(data) - 1 < min(7, remaining):
                raise ProtocolError(f"ECU {source}: quadro consecutivo ISO-TP truncado.")
            progress["data"].extend(data[1:])
            progress["sequence"] = (progress["sequence"] + 1) & 15
            if len(progress["data"]) >= progress["size"]:
                messages.append(Message(source, bytes(progress["data"][:progress["size"]])))
                del pending[source]
        else:
            raise ProtocolError(f"ECU {source}: tipo de quadro ISO-TP não suportado na resposta.")
    if pending:
        raise ProtocolError(f"Resposta ISO-TP incompleta da(s) ECU(s): {', '.join(pending)}.")
    if len({message.source for message in messages}) != len(messages):
        raise ProtocolError("Mais de uma mensagem completa da mesma ECU para uma consulta; não foi feita concatenação implícita.")
    return messages


def select_message(messages: list[Message], source: str | None = None) -> Message:
    if source:
        selected = [message for message in messages if message.source == source.upper()]
        if len(selected) != 1:
            raise NoDataError(f"ECU {source}: não retornou uma resposta única à consulta.")
        return selected[0]
    if len(messages) != 1:
        raise AmbiguousECUError("Mais de uma ECU respondeu. Selecione a origem explicitamente: " + ", ".join(message.source for message in messages))
    return messages[0]


def decode_dtc(first: int, second: int) -> str:
    return f"{'PCBU'[first >> 6]}{(first >> 4) & 3}{first & 15:X}{second:02X}"


def decode_response(message: Message, request: str):
    request = validate_request(request)
    query = bytes.fromhex(request)
    data, source = message.payload, message.source
    if not data:
        raise ProtocolError(f"ECU {source}: mensagem vazia.")
    if data[0] == 0x7F:
        if len(data) != 3 or data[1] != query[0]:
            raise ProtocolError(f"ECU {source}: resposta negativa inválida ou de outro serviço.")
        raise NegativeResponseError(source, data[1], data[2])
    prefix = bytes([query[0] + 0x40, *query[1:]])
    if not data.startswith(prefix):
        raise ProtocolError(f"ECU {source}: resposta não corresponde à consulta {request}.")
    payload = data[len(prefix):]
    if query[0] == 1:
        pid = query[1]
        expected = 4 if pid in SUPPORTED_PAGES else 2 if pid == 0x0C else 1
        if len(payload) != expected:
            raise ProtocolError(f"ECU {source}: resposta {request} truncada ou de tamanho inválido.")
        if pid in SUPPORTED_PAGES:
            bits = int.from_bytes(payload, "big")
            return frozenset(pid + i + 1 for i in range(32) if bits & (1 << (31 - i)))
        return (payload[0] * 256 + payload[1]) / 4 if pid == 0x0C else payload[0] * 100 / 255
    if query[0] in DTC_SERVICES:
        if not message.can:
            raise ProtocolError("DTC sem protocolo CAN confirmado não é interpretado nesta versão.")
        if not payload:
            raise ProtocolError(f"ECU {source}: contador de DTC ausente.")
        count, codes = payload[0], payload[1:]
        if len(codes) < count * 2 or any(codes[count * 2:]):
            raise ProtocolError(f"ECU {source}: contador/tamanho de DTC inconsistente.")
        if any(codes[i:i + 2] == b'\x00\x00' for i in range(0, count * 2, 2)):
            raise ProtocolError(f"ECU {source}: DTC nulo dentro da contagem anunciada.")
        return [decode_dtc(codes[i], codes[i + 1]) for i in range(0, count * 2, 2)]
    pid = query[1]
    if pid == 0:
        if len(payload) != 4:
            raise ProtocolError(f"ECU {source}: lista de PIDs Mode 09 inválida.")
        bits = int.from_bytes(payload, "big")
        return frozenset(i + 1 for i in range(32) if bits & (1 << (31 - i)))
    if not payload or payload[0] < 1:
        raise ProtocolError(f"ECU {source}: contador de identificação ausente ou inválido.")
    count, values = payload[0], payload[1:]
    if pid == 2:
        if count != 1 or len(values) != 17:
            raise ProtocolError(f"ECU {source}: VIN incompleto ou contador inválido.")
        vin = values.decode("ascii", errors="replace")
        if not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", vin):
            raise ProtocolError(f"ECU {source}: VIN não segue o formato de 17 caracteres.")
        return vin
    width = 16 if pid == 4 else 4
    if len(values) != count * width:
        raise ProtocolError(f"ECU {source}: identificação {request} incompleta.")
    records = [values[i:i + width] for i in range(0, len(values), width)]
    if pid == 6:
        return [record.hex().upper() for record in records]
    if any(any(byte != 0 and not 32 <= byte <= 126 for byte in record) for record in records):
        raise ProtocolError(f"ECU {source}: CALID contém caracteres inválidos.")
    return [record.rstrip(b'\x00 ').decode("ascii") for record in records]
