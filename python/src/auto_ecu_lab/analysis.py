"""Medição exploratória de resposta por eventos; limites não são especificações Fiat."""
from bisect import bisect_right
from dataclasses import asdict, dataclass, field
from statistics import median
import math

from .models import DiagnosticCode, Sample, ValidationError, validate_samples


@dataclass(frozen=True)
class AnalysisConfig:
    pedal_rise_pp: float = 10.0
    throttle_rise_pp: float = 3.0
    rpm_rise: float = 100.0
    response_window_s: float = 3.0
    slow_threshold_s: float = 0.5

    def validate(self) -> None:
        if not all(math.isfinite(x) and x > 0 for x in asdict(self).values()):
            raise ValidationError("Parâmetros da análise devem ser positivos e finitos.")
        if self.pedal_rise_pp > 100 or self.throttle_rise_pp > 100:
            raise ValidationError("Variações percentuais não podem exceder 100 pontos percentuais.")


@dataclass
class ResponseEvent:
    time_s: float
    pedal_rise_pp: float
    throttle_delay_s: float | None
    rpm_delay_s: float | None
    end_s: float
    usable: bool = True


@dataclass
class Finding:
    code: str
    level: str
    title: str
    evidence: str
    recommendation: str


@dataclass
class AnalysisResult:
    duration_s: float
    sample_count: int
    interval_s: float
    min_interval_s: float
    max_interval_s: float
    pedal_range: tuple[float, float]
    throttle_range: tuple[float, float]
    rpm_range: tuple[float, float]
    median_throttle_delay_s: float | None
    median_rpm_delay_s: float | None
    events: list[ResponseEvent] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    config: AnalysisConfig = field(default_factory=AnalysisConfig)


def analyze(samples: list[Sample], diagnostics: list[DiagnosticCode] | None = None,
            config: AnalysisConfig | None = None) -> AnalysisResult:
    validate_samples(samples)
    config = config or AnalysisConfig()
    config.validate()
    intervals = [b.time_s - a.time_s for a, b in zip(samples, samples[1:])]
    dt = median(intervals)
    gap_limit = max(0.5, 3 * dt)
    times = [s.time_s for s in samples]
    events = []
    i = 1
    while i < len(samples):
        if samples[i].pedal_pct - samples[i - 1].pedal_pct < 0.5:
            i += 1
            continue
        start = i
        baseline = samples[start - 1]
        while i + 1 < len(samples) and samples[i + 1].pedal_pct - samples[i].pedal_pct > 0.2:
            i += 1
        rise = samples[i].pedal_pct - baseline.pedal_pct
        if rise >= config.pedal_rise_pp:
            onset = samples[start].time_s
            end = min(onset + config.response_window_s, samples[-1].time_s)
            # Encerrar ao soltar o pedal evita associar uma resposta a outro acionamento.
            stop = bisect_right(times, end)
            release = next((samples[j].time_s for j in range(i + 1, stop)
                            if samples[j].pedal_pct < baseline.pedal_pct + rise * 0.3), None)
            if release is not None:
                end = release
            window = [samples[j] for j in range(start, bisect_right(times, end))
                      if release is None or samples[j].time_s < release]
            before = baseline
            usable = True
            for s in window:
                if s.time_s - before.time_s > gap_limit:
                    usable = False
                before = s
            def delay(attribute: str, delta: float) -> float | None:
                if not usable:
                    return None
                return next((round(s.time_s - onset, 6) for s in window
                             if getattr(s, attribute) >= getattr(baseline, attribute) + delta), None)
            events.append(ResponseEvent(onset, round(rise, 3), delay("throttle_pct", config.throttle_rise_pp),
                                        delay("rpm", config.rpm_rise), end, usable))
        i += 1
    throttle_delays = [e.throttle_delay_s for e in events if e.throttle_delay_s is not None]
    rpm_delays = [e.rpm_delay_s for e in events if e.rpm_delay_s is not None]
    findings = []
    if dt > 0.2:
        findings.append(Finding("BAIXA_RESOLUCAO", "info", "Amostragem lenta", f"Intervalo mediano de {dt:.3f} s.",
                                "Atrasos menores que a amostragem não podem ser distinguidos; reduza a quantidade de parâmetros no scanner."))
    if max(intervals) > gap_limit or max(intervals) - min(intervals) > dt * 0.2:
        findings.append(Finding("AMOSTRAGEM_IRREGULAR", "attention", "Tempo de aquisição irregular",
                                f"Intervalos entre {min(intervals):.3f} e {max(intervals):.3f} s; eventos com lacunas são excluídos.",
                                "Confira timestamps e a aquisição sequencial dos canais pelo scanner."))
    if not events:
        findings.append(Finding("SEM_EVENTOS", "info", "Sem acionamentos suficientes",
                                f"Nenhuma subida contínua do pedal de pelo menos {config.pedal_rise_pp:g} pp.",
                                "Use um registro com acionamentos e retornos do pedal; ausência de evento não comprova funcionamento normal."))
    slow = [e for e in events if e.throttle_delay_s is not None and e.throttle_delay_s > config.slow_threshold_s]
    missing = [e for e in events if e.usable and e.throttle_delay_s is None]
    if slow:
        findings.append(Finding("RESPOSTA_LENTA", "attention", "Possível demora de resposta",
                                f"{len(slow)} evento(s) acima do limite exploratório de {config.slow_threshold_s:g} s.",
                                "Correlacione carga, tensão, DTCs e estratégia de torque. O atraso isolado não identifica componente defeituoso."))
    if missing:
        findings.append(Finding("RESPOSTA_AUSENTE", "attention", "Sem resposta observável da borboleta",
                                f"{len(missing)} evento(s) sem aumento de {config.throttle_rise_pp:g} pp na janela disponível.",
                                "Confira se a janela terminou cedo, o significado/unidade do PID e condições do ensaio antes de investigar atuador ou sensor."))
    if max(s.rpm for s in samples) == 0:
        findings.append(Finding("MOTOR_PARADO", "info", "RPM igual a zero em todo o registro", "Não há rotação registrada.",
                                "Verifique se o ensaio foi feito com motor parado; não conclua falha mecânica a partir desse registro."))
    for dtc in diagnostics or []:
        findings.append(Finding(dtc.code, "attention", f"DTC informado: {dtc.code}", f"{dtc.description} · {dtc.status}",
                                "Consulte o procedimento do fabricante e confirme o estado do código no scanner. Código importado não é diagnóstico conclusivo."))
    limits = lambda key: (min(getattr(s, key) for s in samples), max(getattr(s, key) for s in samples))
    return AnalysisResult(samples[-1].time_s - samples[0].time_s, len(samples), dt, min(intervals), max(intervals),
                          limits("pedal_pct"), limits("throttle_pct"), limits("rpm"),
                          median(throttle_delays) if throttle_delays else None,
                          median(rpm_delays) if rpm_delays else None, events, findings, config)
