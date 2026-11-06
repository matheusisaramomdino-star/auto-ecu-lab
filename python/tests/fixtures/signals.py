"""Dados sintéticos reproduzíveis, sem medições reais de uma Strada."""
import csv
import io
import math


SCENARIOS = {"normal": "Resposta de referência", "lenta": "Resposta lenta", "sem_resposta": "Borboleta sem variação"}


def generate_demo_csv(scenario: str) -> bytes:
    if scenario not in SCENARIOS:
        raise ValueError("Cenário inválido")
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Tempo (s)", "Posição do pedal (%)", "Abertura da borboleta (%)", "Rotação do motor (RPM)"])
    throttle, rpm = 5.0, 850.0
    delay = 0.15 if scenario == "normal" else 0.75
    def pedal(t):
        return 35 if 3 <= t < 8 else 62 if 12 <= t < 18 else 85 if 22 <= t < 28 else 0
    for i in range(701):
        t = i * 0.05
        target = 5 + 0.8 * pedal(t - delay)
        if scenario != "sem_resposta":
            throttle += (target - throttle) * (1 - math.exp(-0.05 / 0.18))
        rpm += (850 + 36 * pedal(t - delay - 0.3) - rpm) * (1 - math.exp(-0.05 / 0.5))
        values = (t, pedal(t), throttle, rpm)
        writer.writerow([f"{v:.3f}".replace(".", ",") for v in values])
    return output.getvalue().encode("utf-8-sig")


def scanner_fixture_csv(scenario="lenta") -> bytes:
    """Aquisição artificial distinta dos exemplos legados, só para testes HTTP.

    A declaração do operador é simulada pelos testes; não há captura física.
    """
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["tempo_s", "pedal_pct", "throttle_pct", "rpm"])
    throttle, rpm = 6.0, 812.0
    delay = .8 if scenario == "lenta" else .2
    def pedal(time):
        return 42 if 3 <= time < 9 else 73 if 12.5 <= time < 21 else 0
    for index in range(701):
        time = index * .05
        throttle += (6 + .87 * pedal(time - delay) - throttle) * (1 - math.exp(-.05 / .16))
        rpm += (812 + 29 * pedal(time - delay - .35) - rpm) * (1 - math.exp(-.05 / .4))
        writer.writerow([f"{value:.3f}" for value in (time, pedal(time), throttle, rpm)])
    return output.getvalue().encode("utf-8-sig")

