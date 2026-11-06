import pytest
from auto_ecu_lab.models import Sample
from auto_ecu_lab.web import create_app


@pytest.fixture
def step_samples():
    # Degraus independentes: pedal em 1,0 s, borboleta em 1,4 s, RPM em 1,8 s.
    return [Sample(i / 10, 50 if i >= 10 else 0, 40 if i >= 14 else 5, 2000 if i >= 18 else 850) for i in range(51)]


@pytest.fixture
def app(tmp_path):
    return create_app({"TESTING": True, "SECRET_KEY": "test-only", "DATABASE": str(tmp_path / "lab.sqlite3"), "SEED_DEMO": False})


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def csrf(client):
    client.get("/")
    with client.session_transaction() as session:
        return session["csrf_token"]
