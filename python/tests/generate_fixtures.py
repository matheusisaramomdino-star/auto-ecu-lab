"""Recrie os CSVs fictícios: python -m tests.generate_fixtures."""
from pathlib import Path
from tests.fixtures.signals import SCENARIOS, generate_demo_csv

target = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
target.mkdir(exist_ok=True)
for scenario in SCENARIOS:
    (target / f"strada_{scenario}_ficticio.csv").write_bytes(generate_demo_csv(scenario))
(target / "dtc_ficticio.csv").write_text("codigo;descricao;status\nP0121;Exemplo fictício de plausibilidade do sinal da borboleta;Histórico (fictício)\n", encoding="utf-8-sig")
print(f"Exemplos gerados em {target}")
