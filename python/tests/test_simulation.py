import math
from dataclasses import asdict
import pytest
from auto_ecu_lab.models import Sample, ValidationError
from auto_ecu_lab.simulation import SimulationConfig, simulate


def test_pure_delay_and_first_order_have_analytical_solution():
    samples = [Sample(i / 10, 100 if i >= 10 else 0, 0, 850) for i in range(31)]
    result = simulate(samples, SimulationConfig(delay_s=0.25, tau_s=0.5, maximum_pct=100))
    assert result[12]["simulated_throttle_pct"] == 0
    assert result[13]["simulated_throttle_pct"] == pytest.approx(100 * (1 - math.exp(-0.05 / 0.5)), abs=1e-5)
    assert result[20]["simulated_throttle_pct"] == pytest.approx(100 * (1 - math.exp(-0.75 / 0.5)), abs=1e-5)


def test_zero_delay_does_not_anticipate_input():
    samples = [Sample(i / 10, 100 if i >= 10 else 0, 0, 850) for i in range(30)]
    result = simulate(samples, SimulationConfig(delay_s=0, tau_s=0.5, maximum_pct=100))
    assert result[10]["simulated_throttle_pct"] == 0
    assert result[11]["simulated_throttle_pct"] > 0


def test_different_response_profiles_preserve_input(step_samples):
    original = [asdict(s) for s in step_samples]
    slow = simulate(step_samples, SimulationConfig(delay_s=0.5, tau_s=0.7, gamma=1.6))
    fast = simulate(step_samples, SimulationConfig(delay_s=0.05, tau_s=0.1, gamma=0.7))
    assert fast[15]["simulated_throttle_pct"] > slow[15]["simulated_throttle_pct"]
    assert [asdict(s) for s in step_samples] == original
    assert all(0 <= row["simulated_throttle_pct"] <= 100 for row in fast + slow)
    assert len(slow) == len(step_samples)


@pytest.mark.parametrize("config", [SimulationConfig(delay_s=-1), SimulationConfig(tau_s=0), SimulationConfig(gamma=0), SimulationConfig(maximum_pct=101), SimulationConfig(delay_s=float("inf"))])
def test_invalid_parameters(step_samples, config):
    with pytest.raises(ValidationError):
        simulate(step_samples, config)
