/** Dados sintéticos exclusivos dos testes automatizados; não são distribuídos no site. */
const round = (value, digits) => Number(value.toFixed(digits));
const fail = (message) => { throw new Error(message); };

export function makeDemo(scenario = "lenta") {
  if (!["normal", "lenta", "sem_resposta"].includes(scenario))
    fail("Cenário inválido.");
  let throttle = 5,
    rpm = 850;
  const delay = scenario === "normal" ? 0.15 : 0.75;
  const pedal = (time) =>
    time >= 3 && time < 8
      ? 35
      : time >= 12 && time < 18
        ? 62
        : time >= 22 && time < 28
          ? 85
          : 0;
  return Array.from({ length: 701 }, (_, index) => {
    const time = index * 0.05;
    const target = 5 + 0.8 * pedal(time - delay);
    if (scenario !== "sem_resposta")
      throttle += (target - throttle) * (1 - Math.exp(-0.05 / 0.18));
    rpm +=
      (850 + 36 * pedal(time - delay - 0.3) - rpm) *
      (1 - Math.exp(-0.05 / 0.5));
    return {
      time_s: round(time, 3),
      pedal_pct: pedal(time),
      throttle_pct: round(throttle, 3),
      rpm: round(rpm, 3),
    };
  });
}
