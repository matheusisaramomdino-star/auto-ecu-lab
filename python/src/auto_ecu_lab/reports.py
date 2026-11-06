"""Relatórios portáveis; gráficos HTML usam somente SVG local."""
import csv
from dataclasses import asdict
from datetime import datetime, timezone
import io

from .analysis import AnalysisResult

LIMITATIONS = (
    "Análise exploratória de dados do scanner, sem diagnóstico conclusivo. "
    "Atraso aparente inclui aquisição sequencial, resolução temporal e estratégia de controle. "
    "Os limites configurados não são especificações Fiat ou Rasther. "
    "Pedal e borboleta não têm relação obrigatória de 1:1. RPM depende de carga, marcha e condições do motor. "
    "Sem comunicação ou gravação na ECU; não altera sistemas de segurança ou emissões."
)


def report_payload(recording: dict, result: AnalysisResult) -> dict:
    return {
        "application": "AUTO ECU LAB", "version": "0.1.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "recording": {k: recording[k] for k in ("id", "title", "filename", "created_at", "is_demo", "metadata")},
        "vehicle": asdict(recording["vehicle"]), "analysis": asdict(result),
        "diagnostics": [asdict(d) for d in recording["diagnostics"]],
        "limitations": LIMITATIONS,
        "method": "Início da subida contínua do pedal; primeira ultrapassagem da base da borboleta/RPM mais o limiar configurado. Sem interpolar o atraso. Eventos com lacunas são excluídos.",
    }


def safe_cell(value):
    """Evita interpretar texto importado como fórmula ao abrir CSV em planilhas."""
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def csv_bytes(headers: list[str], rows) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter=";")
    writer.writerow(headers)
    writer.writerows([[safe_cell(v) for v in row] for row in rows])
    return stream.getvalue().encode("utf-8-sig")


def svg_chart(samples) -> str:
    width, height, padding = 1000, 300, 40
    start, end = samples[0].time_s, samples[-1].time_s
    # Limitar representação, preservando todos os dados na análise/exportação.
    indexes = sorted(set([*range(0, len(samples), max(1, len(samples) // 1500)), len(samples) - 1]))
    def path(attribute):
        return " ".join(f"{padding + (samples[i].time_s-start)/(end-start)*(width-2*padding):.2f},{height-padding-getattr(samples[i],attribute)/100*(height-2*padding):.2f}" for i in indexes)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Pedal e borboleta ao longo do tempo, eixo vertical de 0 a 100 por cento">'
            f'<rect width="100%" height="100%" fill="#f5f8fb"/>'
            f'<text x="5" y="25" fill="#374151">100%</text><text x="10" y="265" fill="#374151">0%</text>'
            f'<text x="40" y="290" fill="#374151">{start:.2f} s</text><text x="890" y="290" fill="#374151">{end:.2f} s</text>'
            f'<polyline points="{path("pedal_pct")}" fill="none" stroke="#0b8a73" stroke-width="2"/>'
            f'<polyline points="{path("throttle_pct")}" fill="none" stroke="#c27609" stroke-width="2"/></svg>')
