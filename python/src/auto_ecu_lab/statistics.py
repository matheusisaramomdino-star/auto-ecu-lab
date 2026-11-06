"""Estatísticas de medições documentadas, por coortes comparáveis e sem rede."""
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
from math import ceil
from statistics import median
import unicodedata

from .analysis import AnalysisConfig, analyze
from .models import validate_samples, ValidationError
from .provenance import provenance_issue


def _canonical(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _summary(values) -> dict:
    ordered = sorted(values)
    return {"count": len(values), "minimum": min(values) if values else None,
            "median": median(values) if values else None, "maximum": max(values) if values else None,
            "p95": ordered[ceil(.95 * len(ordered)) - 1] if ordered else None}


def _unknown(value) -> bool:
    if not isinstance(value, str):
        return True
    normalized = "".join(char for char in unicodedata.normalize("NFKD", value.strip().casefold()) if not unicodedata.combining(char))
    return normalized in ("", "nao confirmada", "nao confirmado", "nao informada", "nao informado", "unknown", "not confirmed", "—", "-")


def _received_ecu(metadata):
    connection, identity = metadata.get("connection", {}), metadata.get("identity", {})
    return (connection.get("ecuId") if isinstance(connection, dict) else None) or (identity.get("ecuId") if isinstance(identity, dict) else None) or None


def _known_text(value):
    return None if _unknown(value) else value.strip()


def _utc(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()


def _cohort(recording, result) -> dict:
    vehicle, metadata = recording["vehicle"], recording["metadata"]
    ecu, definition = vehicle.ecu, metadata.get("signal_definitions")
    fields = ("time_s", "pedal_pct", "throttle_pct", "rpm")
    known_signals = isinstance(definition, dict) and all(definition.get(key) for key in fields)
    unknown_ecu = any(_unknown(value) for value in (ecu.identification, ecu.hardware, ecu.software, ecu.source))
    return {"vehicle": {"brand": vehicle.brand, "model": vehicle.model, "year": vehicle.year, "engine": vehicle.engine},
            "ecu": {"identification": _known_text(ecu.identification), "hardware": _known_text(ecu.hardware),
                    "software": _known_text(ecu.software), "manufacturer": _known_text(ecu.manufacturer)},
            "received_ecu_source": _received_ecu(metadata),
            "vehicle_scope": recording.get("vehicle_id", recording["id"]) if unknown_ecu else None,
            "signal_definitions": definition if known_signals else None,
            "recording_scope": recording["id"] if not known_signals else None,
            "source": metadata["provenance"]["source"], "analysis_config": asdict(result.config),
            "median_interval_s": result.interval_s}


def _capture_selection(candidates):
    """Uma captura salva em partes conta uma vez; sobreposição divergente exclui todas."""
    captures, selected, rejected = {}, [], Counter()
    for candidate in candidates:
        recording = candidate[0]
        if recording["metadata"]["provenance"]["kind"] != "scanner_capture":
            selected.append(candidate)
        else:
            captures.setdefault(recording["metadata"]["capture_id"], []).append(candidate)
    for versions in captures.values():
        most_complete = max(versions, key=lambda candidate: (len(candidate[0]["samples"]), -candidate[0]["id"]))
        winner = most_complete[0]
        def context_for(metadata):
            connection = metadata["connection"]
            return (_utc(metadata["provenance"]["captured_at"]), _received_ecu(metadata), metadata["provenance"]["source"],
                    _utc(connection.get("started_at") or connection["started_at_utc"]))
        context = context_for(winner["metadata"])
        conflict = False
        for candidate in versions:
            recording, metadata = candidate[0], candidate[0]["metadata"]
            current_context = context_for(metadata)
            if current_context != context or recording["samples"] != winner["samples"][:len(recording["samples"])]:
                conflict = True
                break
            definitions, winner_definitions = metadata.get("signal_definitions", {}), winner["metadata"].get("signal_definitions", {})
            if isinstance(definitions, dict) and isinstance(winner_definitions, dict):
                if any(definitions[key] != winner_definitions[key] for key in definitions.keys() & winner_definitions.keys()):
                    conflict = True
                    break
        if conflict:
            rejected["captura_conflitante"] += len(versions)
        else:
            selected.append(most_complete)
            rejected["duplicado"] += len(versions) - 1
    return sorted(selected, key=lambda candidate: candidate[0]["id"]), +rejected


def real_statistics(recordings) -> dict:
    """Não inclui demonstração, proveniência incompleta, cópias ou dados inválidos.

    Os registros são estruturas de Repository.recording. Ausências permanecem
    None. A contagem global nunca agrega latências de veículos/ECUs diferentes.
    """
    items = list(recordings)
    excluded, groups, seen_hashes, seen_samples = Counter(), {}, set(), set()
    eligible, candidates = 0, []
    for recording in sorted(items, key=lambda item: item.get("id", 0)):
        if recording.get("is_demo") or recording.get("archived"):
            excluded["demonstracao_ou_arquivado"] += 1
            continue
        metadata = recording.get("metadata")
        issue = provenance_issue(metadata)
        if issue:
            excluded[issue] += 1
            continue
        try:
            validate_samples(recording["samples"])
            config = recording.get("analysis_config", AnalysisConfig())
            config.validate()
            result = analyze(recording["samples"], recording.get("diagnostics", []), config)
            fingerprint = hashlib.sha256(_canonical([asdict(sample) for sample in recording["samples"]]).encode()).hexdigest()
            cohort = _cohort(recording, result)
            key = _canonical(cohort)
            _utc(metadata["provenance"]["captured_at"])
        except (ValidationError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
            excluded["amostras_invalidas"] += 1
            continue
        sha = metadata["provenance"]["sha256"].lower()
        candidates.append((recording, result, cohort, key, sha, fingerprint))
    selected, version_exclusions = _capture_selection(candidates)
    excluded.update(version_exclusions)
    for recording, result, cohort, key, sha, fingerprint in selected:
        metadata = recording["metadata"]
        if sha in seen_hashes or fingerprint in seen_samples:
            excluded["duplicado"] += 1
            continue
        seen_hashes.add(sha)
        seen_samples.add(fingerprint)
        eligible += 1
        if key not in groups:
            groups[key] = {"cohort": cohort, "recording_ids": [], "sample_count": 0, "event_count": 0,
                           "usable_event_count": 0, "gap_event_count": 0, "missing_throttle_response_count": 0,
                           "missing_rpm_response_count": 0, "throttle": [], "rpm": [], "pedal": [], "throttle_signal": [], "rpm_signal": [],
                           "sources": [], "captured_at_start": None, "captured_at_end": None}
        group = groups[key]
        group["recording_ids"].append(recording["id"])
        group["sample_count"] += result.sample_count
        group["event_count"] += len(result.events)
        group["usable_event_count"] += sum(event.usable for event in result.events)
        group["gap_event_count"] += sum(not event.usable for event in result.events)
        group["missing_throttle_response_count"] += sum(event.usable and event.throttle_delay_s is None for event in result.events)
        group["missing_rpm_response_count"] += sum(event.usable and event.rpm_delay_s is None for event in result.events)
        group["throttle"].extend(event.throttle_delay_s for event in result.events if event.usable and event.throttle_delay_s is not None)
        group["rpm"].extend(event.rpm_delay_s for event in result.events if event.usable and event.rpm_delay_s is not None)
        group["pedal"].extend(sample.pedal_pct for sample in recording["samples"])
        group["throttle_signal"].extend(sample.throttle_pct for sample in recording["samples"])
        group["rpm_signal"].extend(sample.rpm for sample in recording["samples"])
        proof = metadata["provenance"]
        group["sources"].append({"recording_id": recording["id"], **proof})
        # Instantes comparados em UTC; fuso original preservado nas fontes.
        captured = _utc(proof["captured_at"])
        group["captured_at_start"] = min(group["captured_at_start"] or captured, captured)
        group["captured_at_end"] = max(group["captured_at_end"] or captured, captured)
    cohorts = []
    for key, group in sorted(groups.items()):
        group["id"] = hashlib.sha256(key.encode()).hexdigest()[:16]
        group["recording_count"] = len(group["recording_ids"])
        group["throttle_delay_s"] = _summary(group.pop("throttle"))
        group["rpm_delay_s"] = _summary(group.pop("rpm"))
        group["pedal_pct"] = _summary(group.pop("pedal"))
        group["throttle_pct"] = _summary(group.pop("throttle_signal"))
        group["rpm"] = _summary(group.pop("rpm_signal"))
        cohorts.append(group)
    return {"schema_version": 1, "scope": "documented_real_measurements", "counts": {
        "active": len(items), "eligible": eligible, "excluded": sum(excluded.values()), "duplicates": excluded.get("duplicado", 0),
        "cohorts": len(cohorts)}, "exclusions": dict(sorted(excluded.items())), "cohorts": cohorts,
        "limitations": "Origem declarada pelo operador ou registrada pelo protocolo; não comprova validação em hardware. Sem média global entre veículos, sem padrão de fábrica e sem percentual de falhas."}
