"""Erros que mantêm ausência, falha de comunicação e leitura válida distintos."""


class DiagnosticsError(Exception):
    pass


class TransportError(DiagnosticsError):
    pass


class ProtocolError(DiagnosticsError):
    pass


class NoDataError(ProtocolError):
    pass


class AmbiguousECUError(ProtocolError):
    pass


class ReadOnlyViolation(DiagnosticsError, ValueError):
    pass


class NegativeResponseError(ProtocolError):
    def __init__(self, source: str, service: int, code: int):
        self.source, self.service, self.code = source, service, code
        super().__init__(f"ECU {source}: resposta negativa ao serviço {service:02X}, NRC {code:02X}.")
