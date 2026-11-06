"""Adaptador CSV documentado; não representa um formato oficial do Rasther."""
import csv
import io
import math
import re
import unicodedata
from dataclasses import dataclass

from .models import DiagnosticCode, Sample, ValidationError, validate_samples

MAX_ROWS = 50000
MAX_BYTES = 5 * 1024 * 1024


def normalized(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


ALIASES = {
    "time_s": {"time_s", "tempo_s", "tempo", "tempo_ms", "time_ms", "timestamp", "tempo_hh_mm_ss"},
    "pedal_pct": {"pedal_pct", "pedal", "pedal_do_acelerador", "posicao_do_pedal", "posicao_pedal"},
    "throttle_pct": {"throttle_pct", "borboleta", "abertura_da_borboleta", "posicao_da_borboleta", "abertura_borboleta"},
    "rpm": {"rpm", "rotacao", "rotacao_rpm", "rotacao_do_motor_rpm", "rotacao_do_motor"},
}


@dataclass
class ImportedSignals:
    samples: list[Sample]
    mapping: dict[str, str]
    encoding: str
    delimiter: str


def read_table(content: bytes) -> tuple[list[str], list[tuple[int, dict]], str, str]:
    if not content or len(content) > MAX_BYTES:
        raise ValidationError("Envie um CSV não vazio de até 5 MB.")
    try:
        text, encoding = content.decode("utf-8-sig"), "UTF-8"
    except UnicodeDecodeError:
        text, encoding = content.decode("cp1252", errors="replace"), "Windows-1252"
    if "\x00" in text or "\ufffd" in text:
        raise ValidationError("Codificação inválida; salve o arquivo em UTF-8 ou Windows-1252.")
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=";,\t")
        reader = csv.DictReader(io.StringIO(text, newline=""), dialect=dialect, strict=True)
        headers = reader.fieldnames or []
        if not headers or any(not h.strip() for h in headers):
            raise ValidationError("Cabeçalho vazio ou inválido.")
        headers = [h.strip() for h in headers]
        if len(set(normalized(h) for h in headers)) != len(headers):
            raise ValidationError("Existem colunas duplicadas no cabeçalho.")
        reader.fieldnames = headers
        rows = []
        for row in reader:
            if len(rows) >= MAX_ROWS:
                raise ValidationError("Limite de 50.000 linhas excedido.")
            if None in row or any(value is None for value in row.values()):
                raise ValidationError(f"Linha {reader.line_num}: quantidade de campos diferente do cabeçalho.")
            rows.append((reader.line_num, row))
        if not rows:
            raise ValidationError("O CSV não contém dados.")
        return headers, rows, encoding, dialect.delimiter
    except csv.Error as exc:
        raise ValidationError("CSV inválido. Use separador ponto e vírgula, vírgula ou tabulação.") from exc


def numeric(value: str) -> float:
    # Sem separadores de milhar: evita converter silenciosamente unidades ambíguas.
    result = float(value.strip().replace(",", "."))
    if not math.isfinite(result):
        raise ValueError("valor não finito")
    return result


def time_value(value: str, header: str, unit: str) -> float:
    if ":" in value:
        parts = value.strip().split(":")
        if len(parts) != 3:
            raise ValueError("use HH:MM:SS.sss")
        hours, minutes, seconds = map(numeric, parts)
        if hours < 0 or hours % 1 or not 0 <= minutes < 60 or minutes % 1 or not 0 <= seconds < 60:
            raise ValueError("horário inválido")
        return hours * 3600 + minutes * 60 + seconds
    result = numeric(value)
    milliseconds = unit == "ms" or (unit == "auto" and normalized(header) in {"tempo_ms", "time_ms"})
    return result / 1000 if milliseconds else result


def import_signals(content: bytes, mapping: dict[str, str] | None = None, time_unit: str = "auto") -> ImportedSignals:
    headers, rows, encoding, delimiter = read_table(content)
    if time_unit not in {"auto", "s", "ms"}:
        raise ValidationError("Unidade de tempo inválida.")
    resolved = {}
    for key, aliases in ALIASES.items():
        explicit = (mapping or {}).get(key, "").strip()
        candidates = [h for h in headers if normalized(h) in aliases]
        if explicit:
            if explicit not in headers:
                raise ValidationError(f"Coluna '{explicit}' não encontrada.")
            resolved[key] = explicit
        elif len(candidates) == 1:
            resolved[key] = candidates[0]
        else:
            raise ValidationError(f"Mapeie a coluna {key}; colunas disponíveis: {', '.join(headers)}.")
    if len(set(resolved.values())) < 4:
        raise ValidationError("Selecione quatro colunas diferentes para tempo, pedal, borboleta e RPM.")
    samples = []
    for line, row in rows:
        try:
            sample = Sample(time_value(row[resolved["time_s"]], resolved["time_s"], time_unit),
                            *[numeric(row[resolved[k]]) for k in ("pedal_pct", "throttle_pct", "rpm")])
            samples.append(sample)
        except (ValueError, OverflowError) as exc:
            raise ValidationError(f"Linha {line}: número ou tempo inválido. Não use unidades dentro das células.") from exc
    validate_samples(samples)
    return ImportedSignals(samples, resolved, encoding, delimiter)


def import_diagnostics(content: bytes) -> list[DiagnosticCode]:
    headers, rows, _, _ = read_table(content)
    lookup = {normalized(h): h for h in headers}
    keys = []
    for names in (("codigo", "dtc", "code"), ("descricao", "description"), ("status", "estado")):
        key = next((lookup[k] for k in names if k in lookup), None)
        if key is None:
            raise ValidationError("Relatório DTC exige colunas: codigo;descricao;status.")
        keys.append(key)
    results = []
    for line, row in rows:
        code, description, status = (row[k].strip() for k in keys)
        if not re.fullmatch(r"[PCBU][0-3][0-9A-F]{3}", code.upper()):
            raise ValidationError(f"Linha {line}: código DTC inválido (exemplo: P0121).")
        if not description or not status or len(description) > 1000 or len(status) > 100:
            raise ValidationError(f"Linha {line}: informe descrição (até 1000 caracteres) e status (até 100).")
        results.append(DiagnosticCode(code.upper(), description, status))
    return results
