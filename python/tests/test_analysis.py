import pytest
from auto_ecu_lab.analysis import AnalysisConfig, analyze
from tests.fixtures.signals import generate_demo_csv
from auto_ecu_lab.importers import import_signals
from auto_ecu_lab.models import DiagnosticCode, Sample, ValidationError


def test_measures_known_delays_from_independent_steps(step_samples):
    result = analyze(step_samples)
    assert len(result.events) == 1
    assert result.events[0].time_s == 1
    assert result.median_throttle_delay_s == pytest.approx(0.4)
    assert result.median_rpm_delay_s == pytest.approx(0.8)
    assert result.interval_s == pytest.approx(0.1)
    assert not result.findings


def test_constant_signal_does_not_invent_zero_latency():
    result = analyze([Sample(i / 10, 0, 5, 850) for i in range(30)])
    assert not result.events
    assert result.median_throttle_delay_s is None
    assert "SEM_EVENTOS" in [f.code for f in result.findings]


@pytest.mark.parametrize("scenario,code", [("lenta", "RESPOSTA_LENTA"), ("sem_resposta", "RESPOSTA_AUSENTE")])
def test_synthetic_fault_scenarios(scenario, code):
    result = analyze(import_signals(generate_demo_csv(scenario)).samples)
    assert len(result.events) == 3
    assert code in [f.code for f in result.findings]


def test_reference_demo_does_not_report_delay_fault():
    result = analyze(import_signals(generate_demo_csv("normal")).samples)
    assert len(result.events) == 3
    assert result.median_throttle_delay_s < 0.5
    assert not result.findings


def test_larger_configured_limit_changes_finding_not_measured_delay(step_samples):
    result = analyze(step_samples, config=AnalysisConfig(slow_threshold_s=0.2))
    assert "RESPOSTA_LENTA" in [f.code for f in result.findings]
    assert result.median_throttle_delay_s == 0.4


def test_acquisition_gap_excludes_event(step_samples):
    samples = [s for s in step_samples if not 1.1 <= s.time_s < 2.2]
    result = analyze(samples)
    assert not result.events[0].usable
    assert result.median_throttle_delay_s is None
    assert "AMOSTRAGEM_IRREGULAR" in [f.code for f in result.findings]
    assert "RESPOSTA_AUSENTE" not in [f.code for f in result.findings]


def test_release_ends_window_before_unrelated_response():
    samples = [Sample(i / 10, 50 if 10 <= i < 12 else 0, 40 if i >= 15 else 5, 850) for i in range(40)]
    result = analyze(samples)
    assert result.events[0].end_s == 1.2
    assert result.events[0].throttle_delay_s is None


def test_gradual_continuous_rise_is_one_event():
    samples = [Sample(i / 10, min(max(0, (i - 10) * 5), 60), 5, 850) for i in range(40)]
    assert len(analyze(samples).events) == 1


def test_dtc_and_motor_stopped_are_contextual():
    result = analyze([Sample(0, 0, 5, 0), Sample(1, 0, 5, 0)], [DiagnosticCode("P0121", "Exemplo", "Histórico")])
    assert {"P0121", "MOTOR_PARADO", "BAIXA_RESOLUCAO"}.issubset({f.code for f in result.findings})


@pytest.mark.parametrize("config", [AnalysisConfig(pedal_rise_pp=0), AnalysisConfig(response_window_s=float("nan")), AnalysisConfig(throttle_rise_pp=101)])
def test_analysis_configuration_validated(step_samples, config):
    with pytest.raises(ValidationError):
        analyze(step_samples, config=config)
