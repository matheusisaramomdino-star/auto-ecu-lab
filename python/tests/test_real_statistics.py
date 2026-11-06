"""Fixtures artificiais isoladas: exercitam o método, nunca alimentam a aplicação."""
from copy import deepcopy
from dataclasses import replace
import json

import pytest

from auto_ecu_lab.analysis import AnalysisConfig
from auto_ecu_lab.models import ECU, Sample, Vehicle
from auto_ecu_lab.provenance import KNOWN_SYNTHETIC_HASHES, provenance_issue
from auto_ecu_lab.statistics import real_statistics


DEFINITIONS = {"time_s": "monotonic_seconds", "pedal_pct": "OBD-II 01 49 percent",
               "throttle_pct": "OBD-II 01 11 percent", "rpm": "OBD-II 01 0C rpm"}


def fixture_recording(recording_id=1):
    return {"id": recording_id, "vehicle_id": 1, "is_demo": 0, "archived": 0,
            "vehicle": Vehicle("Fiat", "Strada", 2022, "1.4", ecu=ECU("Fixture", "ECU-fixture", "HW-fixture", "SW-fixture", "Scanner fixture")),
            "samples": [Sample(i / 10, 50 if i >= 10 else 0, 40 if i >= 14 else 5,
                               (2000 if i >= 18 else 850) + recording_id) for i in range(51)],
            "analysis_config": AnalysisConfig(), "diagnostics": [], "metadata": {
                "signal_definitions": deepcopy(DEFINITIONS), "provenance": {
                    "schema_version": 1, "kind": "scanner_report", "source": "Fixture de scanner",
                    "captured_at": "2026-10-01T10:00:00-04:00", "verification": "operator_confirmed",
                    "reference": f"fixture-{recording_id}.csv", "sha256": f"{recording_id:064x}"}}}


def test_empty_base_has_no_invented_measurements():
    value = real_statistics([])
    assert value["counts"] == {"active": 0, "eligible": 0, "excluded": 0, "duplicates": 0, "cohorts": 0}
    assert value["cohorts"] == []
    assert "median" not in value
    json.dumps(value, allow_nan=False)


def test_cohort_latency_uses_observed_events_and_preserves_provenance():
    first, second = fixture_recording(), fixture_recording(2)
    before = deepcopy([first, second])
    value = real_statistics([first, second])
    assert [first, second] == before
    assert value["counts"]["eligible"] == 2
    group = value["cohorts"][0]
    assert group["recording_ids"] == [1, 2]
    assert group["sample_count"] == 102
    assert group["throttle_delay_s"]["count"] == 2
    assert group["throttle_delay_s"]["median"] == pytest.approx(.4)
    assert group["rpm_delay_s"]["median"] == pytest.approx(.8)
    assert group["throttle_delay_s"]["p95"] == pytest.approx(.4)
    assert group["missing_throttle_response_count"] == group["gap_event_count"] == 0
    assert group["sources"][0]["captured_at"] == "2026-10-01T10:00:00-04:00"
    assert group["captured_at_start"] == "2026-10-01T14:00:00+00:00"


def test_missing_response_is_null_with_zero_observed_count():
    recording = fixture_recording()
    recording["samples"] = [replace(sample, throttle_pct=5, rpm=850) for sample in recording["samples"]]
    group = real_statistics([recording])["cohorts"][0]
    assert group["throttle_delay_s"] == {"count": 0, "minimum": None, "median": None, "maximum": None, "p95": None}
    assert group["missing_throttle_response_count"] == group["missing_rpm_response_count"] == 1
    assert group["rpm_delay_s"]["median"] is None
    assert '"median": null' in json.dumps(group, allow_nan=False)


@pytest.mark.parametrize("change", ["demo", "archived", "unverified", "hash", "date", "simulation", "invalid_samples"])
def test_unproven_or_synthetic_data_never_enters_statistics(change):
    recording = fixture_recording()
    if change in ("demo", "archived"):
        recording["is_demo" if change == "demo" else "archived"] = 1
    elif change == "unverified":
        recording["metadata"] = {"source": "Importado", "is_demo": False}
    elif change == "hash":
        recording["metadata"]["provenance"]["sha256"] = "invalido"
    elif change == "date":
        recording["metadata"]["provenance"]["captured_at"] = "2026-10-01T10:00:00"
    elif change == "simulation":
        recording["metadata"]["operation_mode"] = "simulation"
    else:
        recording["samples"] = [Sample(0, 0, 0, 0)]
    value = real_statistics([recording])
    assert value["counts"]["eligible"] == 0
    assert value["counts"]["excluded"] == 1
    assert value["cohorts"] == []


def test_deduplicates_same_file_hash_and_same_samples_without_mutation():
    first, same_file, same_samples = fixture_recording(), fixture_recording(2), fixture_recording(3)
    same_file["metadata"]["provenance"]["sha256"] = first["metadata"]["provenance"]["sha256"]
    same_samples["samples"] = deepcopy(first["samples"])
    value = real_statistics([same_samples, same_file, first])
    assert value["counts"]["eligible"] == 1
    assert value["counts"]["duplicates"] == 2
    assert value["cohorts"][0]["recording_ids"] == [1]


@pytest.mark.parametrize("difference", ["vehicle", "ecu", "hardware", "software", "signals", "criteria", "unknown_vehicle", "unknown_signals", "unknown_ecu_source", "placeholder_identification"])
def test_incompatible_measurements_remain_in_distinct_cohorts(difference):
    first, second = fixture_recording(), fixture_recording(2)
    if difference == "vehicle":
        second["vehicle"] = replace(second["vehicle"], brand="Toyota", model="Hilux", engine="2.8")
    elif difference in ("ecu", "hardware", "software"):
        field = "identification" if difference == "ecu" else difference
        second["vehicle"] = replace(second["vehicle"], ecu=replace(second["vehicle"].ecu, **{field: "Outra"}))
    elif difference == "signals":
        second["metadata"]["signal_definitions"]["throttle_pct"] = "Outra definição documentada"
    elif difference == "criteria":
        second["analysis_config"] = AnalysisConfig(throttle_rise_pp=4)
    elif difference == "unknown_vehicle":
        first["vehicle"] = replace(first["vehicle"], ecu=ECU())
        second["vehicle"] = replace(second["vehicle"], ecu=ECU())
        second["vehicle_id"] = 2
    elif difference == "unknown_signals":
        del first["metadata"]["signal_definitions"]
        del second["metadata"]["signal_definitions"]
    elif difference in ("unknown_ecu_source", "placeholder_identification"):
        field = "source" if difference == "unknown_ecu_source" else "identification"
        first["vehicle"] = replace(first["vehicle"], ecu=replace(first["vehicle"].ecu, **{field: "Não confirmada"}))
        second["vehicle"] = first["vehicle"]
        second["vehicle_id"] = 2
    value = real_statistics([first, second])
    assert value["counts"]["eligible"] == 2
    assert len(value["cohorts"]) == 2
    assert "throttle_delay_s" not in value


def test_capture_requires_connection_time_capture_id_and_received_ecu():
    metadata = deepcopy(fixture_recording()["metadata"])
    metadata["provenance"].update(kind="scanner_capture", verification="protocol_capture")
    assert provenance_issue(metadata) is not None
    metadata.update(capture_id="fixture-uuid", connection={"started_at": "2026-10-01T14:00:00Z"}, identity={})
    assert provenance_issue(metadata) == "captura_sem_origem_ecu"
    metadata["identity"]["ecuId"] = "7E8"
    assert provenance_issue(metadata) is None


def captured_fixture(recording_id=1, ecu_source="7E8", capture_id="fixture-uuid"):
    recording = fixture_recording(recording_id)
    metadata = recording["metadata"]
    metadata["provenance"].update(kind="scanner_capture", verification="protocol_capture")
    metadata.update(capture_id=capture_id, connection={"started_at": "2026-10-01T14:00:00Z", "ecuId": ecu_source}, identity={"ecuId": ecu_source})
    return recording


def test_received_protocol_ecu_source_separates_same_registered_vehicle():
    first, second = captured_fixture(), captured_fixture(2, "7E9", "another-fixture-uuid")
    value = real_statistics([first, second])
    assert value["counts"]["eligible"] == 2
    assert len(value["cohorts"]) == 2
    assert {group["cohort"]["received_ecu_source"] for group in value["cohorts"]} == {"7E8", "7E9"}


def test_saved_prefix_of_same_capture_counts_once_using_complete_version():
    complete, prefix = captured_fixture(), captured_fixture(2)
    prefix["samples"] = deepcopy(complete["samples"][:30])
    value = real_statistics([prefix, complete])
    assert value["counts"]["eligible"] == value["counts"]["duplicates"] == 1
    assert value["cohorts"][0]["recording_ids"] == [1]
    assert value["cohorts"][0]["sample_count"] == 51


@pytest.mark.parametrize("difference", ["samples", "source", "capture_date", "connection_date", "definitions"])
def test_conflicting_versions_of_capture_id_are_all_excluded(difference):
    first, second = captured_fixture(), captured_fixture(2)
    second["samples"] = deepcopy(first["samples"])
    if difference == "samples":
        second["samples"][0] = replace(second["samples"][0], rpm=1111)
    elif difference == "source":
        second["metadata"]["connection"]["ecuId"] = "7E9"
        second["metadata"]["identity"]["ecuId"] = "7E9"
    elif difference == "capture_date":
        second["metadata"]["provenance"]["captured_at"] = "2026-10-02T10:00:00-04:00"
    elif difference == "connection_date":
        second["metadata"]["connection"]["started_at"] = "2026-10-02T14:00:00Z"
    else:
        second["metadata"]["signal_definitions"]["pedal_pct"] = "Outra definição"
    value = real_statistics([first, second])
    assert value["counts"]["eligible"] == 0
    assert value["counts"]["excluded"] == 2
    assert value["counts"]["duplicates"] == 0
    assert value["exclusions"] == {"captura_conflitante": 2}


def test_nearest_rank_p95_uses_observed_values_without_interpolation():
    first, second = fixture_recording(), fixture_recording(2)
    second["samples"] = [replace(sample, throttle_pct=40 if i >= 16 else 5) for i, sample in enumerate(second["samples"])]
    group = real_statistics([first, second])["cohorts"][0]
    assert group["throttle_delay_s"]["median"] == pytest.approx(.5)
    assert group["throttle_delay_s"]["p95"] == pytest.approx(.6)


def test_repository_requires_documented_revision_license_and_https_source():
    metadata = deepcopy(fixture_recording()["metadata"])
    metadata["provenance"].update(kind="repository_dataset", verification="documented_dataset")
    assert provenance_issue(metadata) == "repositorio_sem_url"
    metadata["provenance"]["repository_url"] = "https://example.org/dataset"
    assert provenance_issue(metadata) == "repositorio_sem_revisao_ou_licenca"
    metadata["provenance"].update(revision="fixture-revision", license="fixture-license")
    assert provenance_issue(metadata) is None


@pytest.mark.parametrize("sha", sorted(KNOWN_SYNTHETIC_HASHES))
@pytest.mark.parametrize("location", ["metadata", "provenance", "diagnostic_report"])
def test_known_legacy_example_hash_is_never_a_real_measurement(sha, location):
    recording = fixture_recording()
    metadata = recording["metadata"]
    target = metadata if location == "metadata" else metadata.setdefault(location, {})
    target["sha256"] = sha.upper()
    value = real_statistics([recording])
    assert value["counts"]["eligible"] == 0
    assert value["exclusions"] == {"dados_ficticios_conhecidos": 1}
