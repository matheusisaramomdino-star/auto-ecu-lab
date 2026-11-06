"""Modelo didático de primeira ordem com atraso, sem modelo de torque ou RPM."""
from bisect import bisect_right
from dataclasses import asdict, dataclass
import math

from .models import Sample, ValidationError, validate_samples


@dataclass(frozen=True)
class SimulationConfig:
    delay_s: float = 0.15
    tau_s: float = 0.25
    gamma: float = 1.0
    maximum_pct: float = 85.0

    def validate(self) -> None:
        if not all(math.isfinite(x) for x in asdict(self).values()):
            raise ValidationError("Parâmetros da simulação devem ser finitos.")
        if not 0 <= self.delay_s <= 3 or not 0.02 <= self.tau_s <= 3:
            raise ValidationError("Atraso: 0–3 s. Constante de tempo: 0,02–3 s.")
        if not 0.3 <= self.gamma <= 3 or not 1 <= self.maximum_pct <= 100:
            raise ValidationError("Curva: 0,3–3. Abertura máxima: 1–100%.")


def simulate(samples: list[Sample], config: SimulationConfig) -> list[dict]:
    validate_samples(samples)
    config.validate()
    times = [s.time_s for s in samples]
    # Interpolação de retenção: cada leitura vale até a próxima amostra.
    # Integrar nos instantes exatos de mudança evita antecipar um degrau.
    changes = [t + config.delay_s for t in times]
    value = min(config.maximum_pct, max(0, samples[0].throttle_pct))
    previous = times[0]
    output = [{"time_s": previous, "simulated_throttle_pct": round(value, 5)}]
    for s in samples[1:]:
        splits = [t for t in changes[bisect_right(changes, previous):bisect_right(changes, s.time_s)] if t < s.time_s]
        for end in [*splits, s.time_s]:
            index = max(0, bisect_right(times, previous - config.delay_s + 1e-10) - 1)
            target = config.maximum_pct * (samples[index].pedal_pct / 100) ** config.gamma
            value = target + (value - target) * math.exp(-(end - previous) / config.tau_s)
            previous = end
        output.append({"time_s": s.time_s, "simulated_throttle_pct": round(min(100, max(0, value)), 5)})
    return output
