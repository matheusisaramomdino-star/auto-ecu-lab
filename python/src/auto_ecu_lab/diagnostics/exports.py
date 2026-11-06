"""Exportação de aquisição real sem preencher sinais ausentes com dados simulados."""
import csv
import io
import json


def _safe(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def live_csv(readings: list[dict]) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["tempo_s", "ecu_origem", "pedal_pct", "throttle_pct", "rpm",
                     "tempo_pedal_s", "tempo_borboleta_s", "tempo_rpm_s", "observacoes", "modo"])
    for reading in readings:
        times = reading.get("channel_times_s", {})
        writer.writerow([_safe(value) for value in [
            reading["time_s"], reading["source"], reading.get("pedal_pct"), reading.get("throttle_pct"), reading.get("rpm"),
            times.get("pedal_pct"), times.get("throttle_pct"), times.get("rpm"),
            json.dumps(reading.get("errors", {}), ensure_ascii=False), reading.get("mode", "real_read_only"),
        ]])
    return output.getvalue()
