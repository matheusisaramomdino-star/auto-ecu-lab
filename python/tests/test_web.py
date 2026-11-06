from dataclasses import asdict
import hashlib
import io
import json
import pytest

from auto_ecu_lab.analysis import AnalysisConfig
from tests.fixtures.signals import generate_demo_csv as legacy_demo_csv, scanner_fixture_csv as generate_demo_csv
from auto_ecu_lab.models import ECU, Vehicle
from auto_ecu_lab.storage import Repository
from auto_ecu_lab.web import create_app


@pytest.fixture
def vehicle_id(app):
    return app.extensions["repository"].add_vehicle(Vehicle("Fiat", "Strada", 2022, "1.4", ecu=ECU(identification="EXEMPLO FICTÍCIO", source="Teste")))


def upload(client, csrf, vehicle_id, content=None, diagnostics=None):
    data = {"csrf_token": csrf, "vehicle_id": str(vehicle_id), "title": "Ensaio de teste", "measurement_source": "Fixture de scanner",
            "captured_at": "2026-10-01T10:00:00-04:00", "real_data": "on",
            "signals": (io.BytesIO(content or generate_demo_csv("lenta")), "rasther.csv")}
    if diagnostics:
        data["diagnostics"] = (io.BytesIO(diagnostics), "dtc.csv")
    return client.post("/importar", data=data, content_type="multipart/form-data", follow_redirects=True)


@pytest.mark.parametrize("path", ["/", "/veiculos", "/importar", "/simulador", "/relatorios", "/estatisticas"])
def test_empty_pages_render_in_portuguese(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert b'lang="pt-BR"' in response.data


def test_vehicle_registration_and_manual_ecu_identification(client, csrf, app):
    response = client.post("/veiculos", data={"csrf_token": csrf, "brand": "Fiat", "model": "Strada", "year": 2022,
                           "engine": "1.4", "manufacturer": "FICTÍCIO", "identification": "ECU-TESTE", "hardware": "HW-1", "software": "SW-1", "ecu_source": "Informada no Rasther III/S"}, follow_redirects=True)
    assert response.status_code == 200
    vehicle = app.extensions["repository"].vehicle(1)
    assert vehicle.ecu.identification == "ECU-TESTE"
    assert vehicle.ecu.hardware == "HW-1"


def test_ecu_source_cannot_be_confirmed_without_identification(client, csrf, app):
    response = client.post("/veiculos", data={"csrf_token": csrf, "brand": "Fiat", "model": "Strada", "year": 2022,
                                           "engine": "1.4", "ecu_source": "Informada no Rasther III/S"})
    assert "Informe a identificação" in response.text
    assert not app.extensions["repository"].vehicles()


def test_import_analysis_and_all_exports(client, csrf, app, vehicle_id):
    content = generate_demo_csv("lenta")
    response = upload(client, csrf, vehicle_id, content)
    assert response.status_code == 200
    assert "Possível demora" in response.text
    assert 'id="signal-chart"' in response.text
    repo = app.extensions["repository"]
    recording = repo.recording(1)
    assert recording["metadata"]["sha256"] == hashlib.sha256(content).hexdigest()
    assert not recording["is_demo"]
    assert recording["vehicle"].ecu.identification == "EXEMPLO FICTÍCIO"
    payload = json.loads(client.get("/ensaios/1/relatorio.json").data)
    assert payload["analysis"]["sample_count"] == 701
    assert payload["analysis"]["events"][0]["throttle_delay_s"] >= 0.75
    html = client.get("/ensaios/1/relatorio.html")
    assert html.status_code == 200
    assert "<svg" in html.text
    assert "Sem comunicação ou gravação" in html.text
    csv = client.get("/ensaios/1/relatorio.csv").data
    assert len(csv.decode("utf-8-sig").splitlines()) == 702


def test_invalid_signals_and_dtc_do_not_create_partial_recordings(client, csrf, app, vehicle_id):
    bad_signal = b"tempo_s;pedal_pct;throttle_pct;rpm\n0;0;5;850\n1;110;5;850"
    response = upload(client, csrf, vehicle_id, bad_signal)
    assert "entre 0 e 100" in response.text
    assert not app.extensions["repository"].recordings()
    response = upload(client, csrf, vehicle_id, diagnostics=b"codigo;descricao;status\nBAD;Exemplo;Ativo")
    assert "DTC inválido" in response.text
    assert not app.extensions["repository"].recordings()


def test_dtc_attachment_is_associated_with_selected_recording(client, csrf, app, vehicle_id):
    upload(client, csrf, vehicle_id)
    response = client.post("/ensaios/1/dtc", data={"csrf_token": csrf, "diagnostics": (io.BytesIO(b"codigo;descricao;status\nP0121;Exemplo ficticio;Historico"), "dtc.csv")}, follow_redirects=True)
    assert response.status_code == 200
    assert "DTC informado: P0121" in response.text
    r = app.extensions["repository"].recording(1)
    assert r["diagnostics"][0].status == "Historico"
    assert len(r["metadata"]["diagnostic_report"]["sha256"]) == 64


def test_configured_analysis_is_used_in_exports(client, csrf, vehicle_id):
    upload(client, csrf, vehicle_id)
    settings = {**asdict(AnalysisConfig(slow_threshold_s=2)), "csrf_token": csrf}
    response = client.post("/ensaios/1/parametros", data=settings, follow_redirects=True)
    assert response.status_code == 200
    payload = json.loads(client.get("/ensaios/1/relatorio.json").data)
    assert payload["analysis"]["config"]["slow_threshold_s"] == 2
    assert "RESPOSTA_LENTA" not in [f["code"] for f in payload["analysis"]["findings"]]


def test_simulation_and_download_do_not_change_recorded_samples(client, csrf, app, vehicle_id):
    upload(client, csrf, vehicle_id)
    repo = app.extensions["repository"]
    before = repo.recording(1)["samples"]
    response = client.post("/api/ensaios/1/simular", headers={"X-CSRF-Token": csrf}, json={"delay_s": 0.1, "tau_s": 0.3})
    assert response.status_code == 200
    assert len(response.json["values"]) == 701
    assert response.json["config"]["delay_s"] == 0.1
    download = client.post("/api/ensaios/1/simular", headers={"X-CSRF-Token": csrf}, json={"download": True})
    assert download.status_code == 200
    assert "borboleta_simulada_pct" in download.data.decode("utf-8-sig")
    assert "atraso_modelo_s" in download.data.decode("utf-8-sig")
    assert repo.recording(1)["samples"] == before


@pytest.mark.parametrize("params", [{"delay_s": -1}, {"tau_s": "invalido"}, {"gamma": None}, {"maximum_pct": 200}, [1, 2]])
def test_bad_simulation_request_returns_readable_error(client, csrf, vehicle_id, params):
    upload(client, csrf, vehicle_id)
    response = client.post("/api/ensaios/1/simular", headers={"X-CSRF-Token": csrf}, json=params)
    assert response.status_code == 400
    assert response.json["error"]


def test_csrf_and_unknown_recordings(client, vehicle_id):
    assert client.post("/demonstracao", data={"vehicle_id": vehicle_id}).status_code == 400
    assert client.get("/?ensaio=99999").status_code == 404
    assert client.get("/ensaios/99999/relatorio.json").status_code == 404


def test_default_database_stays_empty_and_demo_routes_are_removed(tmp_path):
    config = {"TESTING": True, "DATABASE": str(tmp_path / "empty.sqlite3"), "SEED_DEMO": True}
    first = create_app(config)
    second = create_app(config)
    repo = second.extensions["repository"]
    assert not repo.vehicles() and not repo.recordings()
    client = first.test_client()
    assert "base está vazia" in client.get("/").text
    assert client.get("/exemplos/lenta.csv").status_code == 404
    client.get("/")
    with client.session_transaction() as session:
        token = session["csrf_token"]
    assert client.post("/demonstracao", data={"csrf_token": token}).status_code == 404
    assert "Carregar demonstração" not in client.get("/importar").text


def test_persistence_survives_new_repository(app, vehicle_id):
    repo = Repository(app.config["DATABASE"])
    assert repo.vehicle(vehicle_id).model == "Strada"


def test_untrusted_report_text_is_escaped(client, csrf, app):
    repo = app.extensions["repository"]
    vehicle_id = repo.add_vehicle(Vehicle("Fiat", '<script>alert("x")</script>', 2022, "1.4"))
    upload(client, csrf, vehicle_id)
    html = client.get("/ensaios/1/relatorio.html").text
    assert '<script>alert("x")</script>' not in html
    assert "&lt;script&gt;" in html


def test_large_http_body_is_rejected(client, csrf, app):
    app.config["MAX_CONTENT_LENGTH"] = 100
    response = client.post("/importar", data={"csrf_token": csrf, "padding": "x" * 200})
    assert response.status_code == 413


def test_synthetic_import_is_rejected(client, csrf, app, vehicle_id):
    response = client.post("/importar", data={"csrf_token": csrf, "vehicle_id": vehicle_id, "is_demo": "on",
                           "signals": (io.BytesIO(generate_demo_csv("normal")), "strada_ficticio.csv")}, follow_redirects=True)
    assert "Dados fictícios não são aceitos" in response.text
    assert not app.extensions["repository"].recordings()


@pytest.mark.parametrize("missing", ["measurement_source", "captured_at", "real_data"])
def test_real_import_requires_manual_source_capture_time_and_confirmation(client, csrf, app, vehicle_id, missing):
    data = {"csrf_token": csrf, "vehicle_id": vehicle_id, "measurement_source": "Fixture de scanner",
            "captured_at": "2026-10-01T10:00:00-04:00", "real_data": "on",
            "signals": (io.BytesIO(generate_demo_csv("normal")), "fixture.csv")}
    data.pop(missing)
    response = client.post("/importar", data=data)
    assert response.status_code == 200
    assert not app.extensions["repository"].recordings()


def test_real_statistics_api_and_page_preserve_original_and_exclude_unverified(client, csrf, app, vehicle_id):
    upload(client, csrf, vehicle_id)
    repo = app.extensions["repository"]
    original = repo.recording(1)
    legacy_id = repo.add_recording(vehicle_id, "Legado sem confirmação", "legacy.csv", original["samples"], {"source": "Antigo", "is_demo": False})
    demo_id = repo.add_recording(vehicle_id, "Fixture arquivada", "demo.csv", original["samples"], {}, is_demo=True)
    before = client.get("/ensaios/1/relatorio.csv").data
    value = client.get("/api/estatisticas").json
    assert value["counts"] == {"active": 2, "eligible": 1, "excluded": 1, "duplicates": 0, "cohorts": 1, "archived_demo": 1}
    assert value["exclusions"] == {"proveniencia_ausente": 1}
    assert value["cohorts"][0]["sources"][0]["verification"] == "operator_confirmed"
    assert "Fixture de scanner" in client.get("/estatisticas").text
    assert repo.recording(1) == original
    assert client.get("/ensaios/1/relatorio.csv").data == before
    assert client.get(f"/ensaios/{legacy_id}/relatorio.json").status_code == 200
    assert client.get(f"/ensaios/{demo_id}/relatorio.json").status_code == 404


def test_import_local_time_requires_explicit_timezone(client, csrf, app, vehicle_id):
    data = {"csrf_token": csrf, "vehicle_id": vehicle_id, "measurement_source": "Fixture de scanner", "real_data": "on",
            "captured_at": "2026-10-01T10:00:00", "capture_timezone": "-04:00",
            "signals": (io.BytesIO(generate_demo_csv("normal")), "fixture.csv")}
    assert client.post("/importar", data=data).status_code == 302
    assert app.extensions["repository"].recording(1)["metadata"]["provenance"]["captured_at"] == "2026-10-01T10:00:00-04:00"


@pytest.mark.parametrize("scenario", ["normal", "lenta", "sem_resposta"])
def test_known_legacy_example_cannot_be_reimported_as_confirmed_real(client, csrf, app, vehicle_id, scenario):
    response = upload(client, csrf, vehicle_id, legacy_demo_csv(scenario))
    assert "Arquivo de demonstração conhecido" in response.text
    assert not app.extensions["repository"].recordings()


def test_known_legacy_dtc_cannot_enter_import_or_attachment(client, csrf, app, vehicle_id):
    from pathlib import Path
    content = (Path(__file__).parent / "fixtures" / "dtc_ficticio.csv").read_bytes()
    response = upload(client, csrf, vehicle_id, diagnostics=content)
    assert "Arquivo de demonstração conhecido" in response.text
    assert not app.extensions["repository"].recordings()
    upload(client, csrf, vehicle_id)
    response = client.post("/ensaios/1/dtc", data={"csrf_token": csrf, "diagnostics": (io.BytesIO(content), "dtc.csv")}, follow_redirects=True)
    assert "Relatório DTC de demonstração conhecido" in response.text
    assert app.extensions["repository"].recording(1)["diagnostics"] == []


def test_user_facing_time_uses_manaus(app):
    assert app.jinja_env.filters["local_time"]("2026-11-05T15:00:00+00:00") == "05/11/2026 11:00:00 · Manaus (UTC−4)"
