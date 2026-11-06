"""Metadados JSON inválidos são excluídos, sem derrubar as estatísticas."""
from copy import deepcopy

import pytest

from auto_ecu_lab.models import ValidationError
from auto_ecu_lab.provenance import provenance_issue, scanner_report_provenance, timezone_timestamp


def valid_metadata():
    return {"provenance": {
        "schema_version": 1, "kind": "scanner_report", "source": "Scanner de fixture",
        "captured_at": "2026-10-01T10:00:00-04:00", "verification": "operator_confirmed",
        "reference": "fixture.csv", "sha256": "a" * 64,
    }}


def valid_capture_metadata():
    metadata = valid_metadata()
    metadata["provenance"].update(kind="scanner_capture", verification="protocol_capture")
    metadata.update(capture_id="fixture-capture", connection={"started_at": "2026-10-01T14:00:00Z", "ecuId": "7E8"},
                    identity={"ecuId": "7E8"})
    return metadata


@pytest.mark.parametrize("metadata", [None, False, True, 0, 1.0, "texto", [], [1], {}])
def test_non_mapping_json_is_excluded_without_exception(metadata):
    assert isinstance(provenance_issue(metadata), str)


@pytest.mark.parametrize("field", ["schema_version", "kind", "source", "reference", "captured_at", "verification", "sha256"])
@pytest.mark.parametrize("value", [None, False, True, 0, 1.0, [], {}])
def test_contract_rejects_wrong_json_types_without_exception(field, value):
    metadata = valid_metadata()
    metadata["provenance"][field] = value
    assert isinstance(provenance_issue(metadata), str)


@pytest.mark.parametrize("value", [None, False, [], {}, "", " ", "abc", "g" * 64, "a" * 63, "a" * 65])
def test_hash_must_be_exactly_64_hex_characters(value):
    metadata = valid_metadata()
    metadata["provenance"]["sha256"] = value
    assert provenance_issue(metadata) == "hash_ausente_ou_invalido"


@pytest.mark.parametrize("value", [None, False, [], {}, "", " ", "2026-10-01T10:00:00",
                                   "0001-01-01T00:00:00+23:00", "9999-12-31T23:59:59-04:00"])
def test_timestamp_must_include_timezone_and_fit_in_utc(value):
    assert timezone_timestamp(value) is False
    metadata = valid_metadata()
    metadata["provenance"]["captured_at"] = value
    assert provenance_issue(metadata) == "data_de_captura_invalida"


@pytest.mark.parametrize("url", [None, False, [], {}, "https://[", "https://[xyz]", "https://example.org:bad",
                                "https://example.org:99999", "http://example.org/data", "https:///data"])
def test_malformed_repository_url_is_excluded_without_exception(url):
    metadata = valid_metadata()
    metadata["provenance"].update(kind="repository_dataset", verification="documented_dataset",
                                 repository_url=url, revision="fixture-revision", license="MIT")
    assert provenance_issue(metadata) == "repositorio_sem_url"


def test_valid_contract_is_preserved_without_mutation():
    metadata = valid_metadata()
    before = deepcopy(metadata)
    assert provenance_issue(metadata) is None
    assert metadata == before
    metadata["provenance"]["sha256"] = "ABCDEF" * 10 + "ABCD"
    assert provenance_issue(metadata) is None
    assert timezone_timestamp("2026-10-01T14:00:00Z") is True


@pytest.mark.parametrize("confirmed", [False, None, "true", 1, [], {}])
def test_report_builder_requires_explicit_boolean_confirmation(confirmed):
    proof = valid_metadata()["provenance"]
    with pytest.raises(ValidationError, match="Confirme"):
        scanner_report_provenance(source=proof["source"], captured_at=proof["captured_at"],
            reference=proof["reference"], sha256=proof["sha256"], confirmed=confirmed)


@pytest.mark.parametrize("field", ["source", "captured_at", "reference", "sha256"])
def test_report_builder_reports_invalid_json_fields_as_validation_error(field):
    proof = valid_metadata()["provenance"]
    arguments = {key: proof[key] for key in ("source", "captured_at", "reference", "sha256")}
    arguments[field] = []
    with pytest.raises(ValidationError):
        scanner_report_provenance(**arguments, confirmed=True)


@pytest.mark.parametrize("field", ["capture_id", "connection", "identity"])
@pytest.mark.parametrize("value", [None, False, 0, [], ""])
def test_capture_rejects_missing_or_wrong_json_structures(field, value):
    metadata = valid_capture_metadata()
    metadata[field] = value
    assert isinstance(provenance_issue(metadata), str)


@pytest.mark.parametrize("value", [False, 0, [], {}, " ", "Não confirmada", "Unknown", "—"])
def test_capture_rejects_non_received_ecu_placeholders(value):
    metadata = valid_capture_metadata()
    metadata["connection"]["ecuId"] = value
    assert provenance_issue(metadata) == "captura_sem_origem_ecu"


def test_capture_rejects_conflicting_ecu_origins_but_accepts_equal_case_insensitive_addresses():
    metadata = valid_capture_metadata()
    metadata["identity"]["ecuId"] = "7E9"
    assert provenance_issue(metadata) == "captura_com_origens_ecu_divergentes"
    metadata["identity"]["ecuId"] = " 7e8 "
    assert provenance_issue(metadata) is None
    metadata["identity"]["ecuId"] = None
    assert provenance_issue(metadata) is None
