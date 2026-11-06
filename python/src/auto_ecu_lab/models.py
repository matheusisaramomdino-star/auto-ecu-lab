"""Tipos compartilhados pelos adaptadores, análise e persistência."""
from dataclasses import asdict, dataclass, field
import math


class ValidationError(ValueError):
    """Erro de entrada que pode ser apresentado ao usuário."""


@dataclass(frozen=True)
class Sample:
    time_s: float
    pedal_pct: float
    throttle_pct: float
    rpm: float


def validate_samples(samples: list[Sample]) -> None:
    if len(samples) < 2:
        raise ValidationError("São necessárias pelo menos duas amostras.")
    previous = -1.0
    for number, sample in enumerate(samples, 1):
        if not all(math.isfinite(x) for x in asdict(sample).values()):
            raise ValidationError(f"Amostra {number}: valores devem ser finitos.")
        if sample.time_s < 0 or sample.time_s <= previous:
            raise ValidationError(f"Amostra {number}: tempo deve ser crescente, sem duplicatas e não negativo.")
        if not 0 <= sample.pedal_pct <= 100 or not 0 <= sample.throttle_pct <= 100:
            raise ValidationError(f"Amostra {number}: pedal e borboleta devem estar entre 0 e 100%.")
        if not 0 <= sample.rpm <= 15000:
            raise ValidationError(f"Amostra {number}: RPM fora do intervalo de importação (0–15000).")
        previous = sample.time_s


@dataclass(frozen=True)
class ECU:
    manufacturer: str = ""
    identification: str = ""
    hardware: str = ""
    software: str = ""
    source: str = "Não confirmada"


@dataclass(frozen=True)
class Vehicle:
    brand: str
    model: str
    year: int
    engine: str
    plate: str = ""
    ecu: ECU = field(default_factory=ECU)

    def validate(self) -> None:
        if not self.brand.strip() or not self.model.strip() or not self.engine.strip():
            raise ValidationError("Informe marca, modelo e motorização.")
        if not 1900 <= self.year <= 2100:
            raise ValidationError("Ano deve estar entre 1900 e 2100.")
        if any(len(value) > 200 for value in [self.brand, self.model, self.engine, self.plate, *asdict(self.ecu).values()]):
            raise ValidationError("Cada campo do cadastro aceita até 200 caracteres.")


@dataclass(frozen=True)
class DiagnosticCode:
    code: str
    description: str
    status: str
