"""Diagnóstico real por consultas documentadas, separado da simulação.

Importar este pacote não descobre dispositivos nem abre conexões. O cliente
ELM327 expõe apenas consultas OBD-II de leitura; SDKs proprietários permanecem
dependências explícitas, sem emulação de integração.
"""
from .elm327 import ELM327Client, LiveReading
from .errors import DiagnosticsError, NoDataError, ProtocolError, ReadOnlyViolation
from .obd import decode_dtc, decode_response, parse_elm_response, validate_request
from .registry import INTEGRATIONS

__all__ = [
    "ELM327Client", "LiveReading", "DiagnosticsError", "NoDataError", "ProtocolError",
    "ReadOnlyViolation", "decode_dtc", "decode_response", "parse_elm_response",
    "validate_request", "INTEGRATIONS",
]
