import pytest
from tests.fixtures.signals import SCENARIOS, generate_demo_csv
from auto_ecu_lab.importers import import_diagnostics, import_signals
from auto_ecu_lab.models import ValidationError

HEADER = "tempo_s;pedal_pct;throttle_pct;rpm\n"


def test_brazilian_csv_with_bom_and_decimal_comma():
    result = import_signals((HEADER + "0,0;0;5;850\n0,1;30;7,5;900\n").encode("utf-8-sig"))
    assert result.samples[1].time_s == 0.1
    assert result.samples[1].throttle_pct == 7.5
    assert result.delimiter == ";"
    assert result.mapping["rpm"] == "rpm"


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_every_demo_uses_real_import_path(scenario):
    result = import_signals(generate_demo_csv(scenario))
    assert len(result.samples) == 701
    assert result.samples[-1].time_s == 35


@pytest.mark.parametrize("delimiter", [",", "\t", ";"])
def test_delimiters(delimiter):
    text = "tempo_s;pedal_pct;throttle_pct;rpm\n0;0;5;850\n0.1;30;10;950\n".replace(";", delimiter)
    assert import_signals(text.encode()).samples[1].rpm == 950


def test_windows_1252_aliases():
    data = "Tempo (ms);Posição do pedal (%);Abertura da borboleta (%);Rotação do motor (RPM)\n0;0;5;850\n100;30;8;950".encode("cp1252")
    result = import_signals(data)
    assert result.encoding == "Windows-1252"
    assert result.samples[1].time_s == 0.1


def test_explicit_mapping_and_millisecond_override():
    data = b"T;APP;TPS;N\n0;0;5;850\n50;30;10;1000"
    result = import_signals(data, {"time_s": "T", "pedal_pct": "APP", "throttle_pct": "TPS", "rpm": "N"}, "ms")
    assert result.samples[1].time_s == 0.05


def test_hh_mm_ss_relative_duration():
    data = (HEADER + "12:01:00,0;0;5;850\n12:01:00,2;10;5;850").encode()
    result = import_signals(data)
    assert result.samples[1].time_s - result.samples[0].time_s == pytest.approx(0.2)


@pytest.mark.parametrize("body", [
    "0;0;5;850\n0;10;8;950", "1;0;5;850\n0;10;8;950", "-1;0;5;850\n0;10;8;950",
    "0;0;5;850\n1;101;8;950", "0;0;5;850\n1;10;-1;950", "0;0;5;850\n1;10;8;15001",
    "0;0;5;850\n1;NaN;8;950", "0;0;5;850\n1;10;inf;950", "0;0;5;850\n1;10;8;-1",
    "0;0;5;850\n1;;8;950", "0;0;5;850\n1;30%;8;950", "0;0;5;850",
    "00:61:00;0;5;850\n00:62:00;10;8;950", "0;0;5;850\n1;10;8;950;extra",
])
def test_rejects_invalid_data_without_silent_cleanup(body):
    with pytest.raises(ValidationError):
        import_signals((HEADER + body).encode())


@pytest.mark.parametrize("data", [b"", b"x;y\n1;2\n3;4", b"tempo_s;tempo_s;pedal_pct;throttle_pct;rpm\n0;0;0;5;850\n1;1;10;10;900", b"\x00binary"])
def test_invalid_headers_and_content(data):
    with pytest.raises(ValidationError):
        import_signals(data)


def test_explicit_mapping_must_use_different_columns():
    with pytest.raises(ValidationError, match="diferentes"):
        import_signals((HEADER + "0;0;5;850\n1;10;8;950").encode(), {"pedal_pct": "rpm"})


def test_ambiguous_alias_requires_mapping():
    with pytest.raises(ValidationError, match="Mapeie"):
        import_signals(b"tempo_s;pedal_pct;pedal;throttle_pct;rpm\n0;0;0;5;850\n1;30;30;10;900")


def test_file_size_and_row_limits(monkeypatch):
    monkeypatch.setattr("auto_ecu_lab.importers.MAX_BYTES", 10)
    with pytest.raises(ValidationError, match="5 MB"):
        import_signals(b"a" * 11)
    monkeypatch.setattr("auto_ecu_lab.importers.MAX_BYTES", 10000)
    monkeypatch.setattr("auto_ecu_lab.importers.MAX_ROWS", 1)
    with pytest.raises(ValidationError, match="50.000"):
        import_signals((HEADER + "0;0;5;850\n1;30;10;900").encode())


def test_diagnostic_report_preserves_status_and_description():
    codes = import_diagnostics("codigo;descricao;status\np0121;Exemplo fictício;Histórico".encode())
    assert codes[0].code == "P0121"
    assert codes[0].status == "Histórico"


@pytest.mark.parametrize("data", [b"code;status\nP0121;Ativo", b"codigo;descricao;status\nINVALID;Exemplo;Ativo", b"codigo;descricao;status\nP0121;;Ativo"])
def test_invalid_diagnostic_report(data):
    with pytest.raises(ValidationError):
        import_diagnostics(data)
