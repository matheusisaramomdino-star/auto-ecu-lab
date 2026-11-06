"""Proveniência declarada, sem confundir importação com validação em hardware.

Um hash permite rastrear arquivos; não demonstra, sozinho, que houve uma medição.
"""
from datetime import datetime, timezone
import re
from urllib.parse import urlsplit

from .models import ValidationError


# Impressões dos arquivos sintéticos publicados em versões antigas, inclusive
# DTC. Não há dados de medição ou gerador de exemplo no pacote de produção.
KNOWN_SYNTHETIC_HASHES = frozenset((
    "53254c006f64532c1945b6af348cf578c34f6f3317945fd1ca75e4da5417c737",
    "7e76d92b651f3a22d5a1690e858e2b446e44e26361b32a1973cf8c6eb2187e8a",
    "104d34f93c0d865b50ede79c6b77690dc0db89e066963dcad33b398cacc8b81f",
    "25ec1b8ac5d63fbb95abe8266c5c055ba6904be136a6b4a164894c8b7bb96cb6",
    "f95fc65de33bd4d83fdc7187504b13a0784537c61a95fc80da3e08f39db192cb",
    "c2fa25a7f72d13d5e10ef85ae46f1288273eac2f013a948a273d05428edc7666",
    "679b9d8a5c1bfa7f053af4149c1220cb09c0abb554eb388dd1c13ab2c7c9f97a",
))


def known_synthetic_hash(value) -> bool:
    return isinstance(value, str) and value.lower() in KNOWN_SYNTHETIC_HASHES


def timezone_timestamp(value) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if date.tzinfo is None or date.utcoffset() is None:
            return False
        # A data local pode caber em datetime e transbordar ao converter para
        # UTC (anos 0001/9999 com deslocamento). As estatísticas usam UTC.
        date.astimezone(timezone.utc)
        return True
    except (ValueError, OverflowError):
        return False


def provenance_issue(metadata: dict) -> str | None:
    """Retorna motivo da exclusão; None significa contrato documental atendido."""
    if not isinstance(metadata, dict):
        return "proveniencia_ausente"
    if metadata.get("is_demo") or metadata.get("operation_mode") in ("simulation", "simulated", "demo"):
        return "simulacao"
    proof = metadata.get("provenance")
    diagnostic = metadata.get("diagnostic_report")
    hashes = (metadata.get("sha256"), proof.get("sha256") if isinstance(proof, dict) else None,
              diagnostic.get("sha256") if isinstance(diagnostic, dict) else None)
    if any(known_synthetic_hash(value) for value in hashes):
        return "dados_ficticios_conhecidos"
    if not isinstance(proof, dict) or type(proof.get("schema_version")) is not int or proof["schema_version"] != 1:
        return "proveniencia_ausente"
    if not all(isinstance(proof.get(key), str) and proof[key].strip() for key in ("source", "reference")):
        return "origem_incompleta"
    if not timezone_timestamp(proof.get("captured_at")):
        return "data_de_captura_invalida"
    if not isinstance(proof.get("sha256"), str) or not re.fullmatch(r"[0-9a-fA-F]{64}", proof["sha256"]):
        return "hash_ausente_ou_invalido"
    kind = proof.get("kind")
    expected = {"scanner_capture": "protocol_capture", "scanner_report": "operator_confirmed", "repository_dataset": "documented_dataset"}
    if not isinstance(kind, str) or kind not in expected or proof.get("verification") != expected[kind]:
        return "verificacao_incompativel"
    if kind == "scanner_capture":
        connection, identity = metadata.get("connection"), metadata.get("identity")
        if not isinstance(connection, dict) or not isinstance(identity, dict):
            return "captura_sem_conexao_ou_ecu"
        if not isinstance(metadata.get("capture_id"), str) or not metadata["capture_id"].strip():
            return "captura_sem_identificador"
        if not timezone_timestamp(connection.get("started_at") or connection.get("started_at_utc")):
            return "captura_sem_inicio_de_conexao"
        ecu_sources = [value for value in (connection.get("ecuId"), identity.get("ecuId"))
                       if value is not None and value != ""]
        placeholders = {"não confirmada", "não confirmado", "nao confirmada", "nao confirmado", "unknown", "—", "-"}
        if not ecu_sources or any(not isinstance(value, str) or not value.strip()
                                  or value.strip().casefold() in placeholders for value in ecu_sources):
            return "captura_sem_origem_ecu"
        if len({value.strip().casefold() for value in ecu_sources}) > 1:
            return "captura_com_origens_ecu_divergentes"
    if kind == "repository_dataset":
        url = proof.get("repository_url")
        if not isinstance(url, str):
            return "repositorio_sem_url"
        try:
            parsed = urlsplit(url)
            if parsed.scheme != "https" or not parsed.hostname:
                return "repositorio_sem_url"
            # Acesso à propriedade também valida portas malformadas/fora da
            # faixa; urlsplit, sozinho, não faz essa verificação.
            parsed.port
        except (ValueError, UnicodeError):
            return "repositorio_sem_url"
        if not all(isinstance(proof.get(key), str) and proof[key].strip() for key in ("revision", "license")):
            return "repositorio_sem_revisao_ou_licenca"
    return None


def scanner_report_provenance(*, source: str, captured_at: str, reference: str, sha256: str, confirmed: bool) -> dict:
    """Somente o formulário confirmado pelo operador constrói este contrato."""
    if confirmed is not True:
        raise ValidationError("Confirme que o arquivo contém uma medição real, sem dados fictícios ou simulados.")
    proof = {"schema_version": 1, "kind": "scanner_report", "source": source.strip() if isinstance(source, str) else "",
             "captured_at": captured_at.strip() if isinstance(captured_at, str) else "", "verification": "operator_confirmed",
             "reference": reference, "sha256": sha256}
    issue = provenance_issue({"provenance": proof})
    if issue == "dados_ficticios_conhecidos":
        raise ValidationError("Arquivo de demonstração conhecido: dados fictícios não são aceitos como medições reais.")
    if issue:
        raise ValidationError("Informe a origem do scanner e a data real da captura com fuso horário válido.")
    return proof
