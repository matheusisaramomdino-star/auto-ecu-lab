"""Entrada explícita para operação real: python -m auto_ecu_lab.diagnostics read ..."""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys
import time
from uuid import uuid4

from .elm327 import ELM327Client
from .errors import DiagnosticsError
from .exports import live_csv
from .registry import integration_records
from .transports import BleTransport, SerialTransport, WifiTransport


SIGNAL_DEFINITIONS = {
    "time_s": (None, "monotonic_seconds"),
    "pedal_pct": ("49", "OBD-II 01 49 percent"),
    "throttle_pct": ("11", "OBD-II 01 11 percent"),
    "rpm": ("0C", "OBD-II 01 0C rpm"),
}


def build_parser():
    parser = argparse.ArgumentParser(description="AUTO ECU LAB — Auto Elétrica Doidinho: diagnóstico ELM327 somente leitura")
    subparsers = parser.add_subparsers(dest="action")
    subparsers.add_parser("integrations", help="Listar capacidades e integrações pendentes, sem conexão")
    read = subparsers.add_parser("read", help="Conectar explicitamente e consultar dados OBD-II de leitura")
    read.add_argument("--transport", choices=("serial", "wifi", "ble"), required=True)
    read.add_argument("--device", help="Porta COM/serial ou endereço/identificador BLE documentado")
    read.add_argument("--baudrate", type=int, default=38400)
    read.add_argument("--host", help="Endereço do ELM327 Wi-Fi, conforme o fabricante")
    read.add_argument("--port", type=int, help="Porta TCP documentada, sem valor presumido")
    read.add_argument("--service-uuid")
    read.add_argument("--rx-uuid", help="Característica que notifica respostas")
    read.add_argument("--tx-uuid", help="Característica que aceita consultas")
    read.add_argument("--ble-without-response", action="store_true", help="Usar somente se a documentação exigir write-without-response")
    read.add_argument("--ecu", help="ID da ECU, por exemplo 7E8; obrigatório se várias responderem")
    read.add_argument("--timeout", type=float, default=5)
    read.add_argument("--duration", type=float, default=5, help="Duração em segundos, entre 0 e 600")
    read.add_argument("--interval", type=float, default=0.5, help="Pausa após cada ciclo; a aquisição é sequencial")
    read.add_argument("--output", type=Path, required=True, help="CSV local para as leituras; um JSON complementar também é gerado")
    return parser


def transport_for(args):
    if args.transport == "serial":
        if not args.device:
            raise ValueError("O transporte serial exige --device (porta documentada).")
        return SerialTransport(args.device, args.baudrate, args.timeout)
    if args.transport == "wifi":
        if not args.host or args.port is None:
            raise ValueError("Wi-Fi exige --host e --port conforme a documentação do adaptador.")
        return WifiTransport(args.host, args.port, args.timeout)
    if not all((args.device, args.service_uuid, args.rx_uuid, args.tx_uuid)):
        raise ValueError("BLE exige --device, --service-uuid, --rx-uuid e --tx-uuid documentados.")
    return BleTransport(args.device, args.service_uuid, args.rx_uuid, args.tx_uuid, args.timeout,
                        write_response=not args.ble_without_response)


async def acquire(args):
    if not math.isfinite(args.duration) or not 0 <= args.duration <= 600:
        raise ValueError("Duração deve estar entre 0 e 600 segundos.")
    if not math.isfinite(args.interval) or not 0.05 <= args.interval <= 60:
        raise ValueError("Intervalo deve estar entre 0,05 e 60 segundos.")
    if args.output.suffix.lower() != ".csv":
        raise ValueError("O arquivo --output deve terminar em .csv.")
    client = ELM327Client(transport_for(args), timeout=args.timeout)
    capture_id = str(uuid4())
    report = {"application": "AUTO ECU LAB", "workshop": "Auto Elétrica Doidinho", "mode": "real_read_only", "is_demo": False,
              "created_at_utc": datetime.now(timezone.utc).isoformat(),
              "transport": args.transport, "readings": [], "errors": [],
              "metadata": {"operation_mode": "real", "capture_id": capture_id,
                           "connection": {"transport": args.transport}, "identity": {}, "provenance": None},
              "note": "Consultas documentadas de leitura. Não grava ECU, não apaga DTCs nem altera segurança/emissões. Validação em hardware ainda necessária."}
    operation_error = None
    try:
        await client.connect()
        connection = report["metadata"]["connection"]
        connection["started_at"] = datetime.now(timezone.utc).isoformat()
        connection["started_at_utc"] = connection["started_at"]
        await client.initialize()
        connection["adapter"] = "ELM327"
        report["discovery"] = await client.discover(args.ecu)
        # Somente a origem recebida pelo protocolo confirma uma ECU nesta captura.
        # --ecu é uma seleção solicitada pelo operador, nunca uma identificação recebida.
        source = report["discovery"].get("source")
        if isinstance(source, str) and source.strip():
            connection["ecuId"] = source
            report["metadata"]["identity"]["ecuId"] = source
            report["metadata"]["provenance"] = {
                "schema_version": 1, "kind": "scanner_capture",
                "source": "ELM327 · aquisição OBD-II somente leitura",
                "captured_at": connection["started_at"], "verification": "protocol_capture",
                "reference": capture_id,
            }
        report["identification"] = await client.identify()
        if client.connected:
            report["diagnostics"] = await client.read_diagnostics()
        started = time.monotonic()
        while client.connected:
            reading = await client.read_live()
            report["readings"].append(reading.as_record())
            if time.monotonic() - started >= args.duration:
                break
            await asyncio.sleep(min(args.interval, max(0, args.duration - (time.monotonic() - started))))
    except (DiagnosticsError, OSError, ValueError) as exc:
        operation_error = exc
        report["errors"].append(str(exc))
    except asyncio.CancelledError:
        report["errors"].append("Aquisição interrompida; o arquivo contém somente as leituras já concluídas.")
        raise
    finally:
        try:
            await client.disconnect()
        except Exception as exc:
            report["errors"].append(f"Falha ao encerrar transporte: {type(exc).__name__}.")
        # Preservar leituras parciais mesmo quando o adaptador cai no meio do ensaio.
        args.output.parent.mkdir(parents=True, exist_ok=True)
        csv_bytes = live_csv(report["readings"]).encode("utf-8-sig")
        args.output.write_bytes(csv_bytes)
        supported = report.get("discovery", {}).get("supported_pids", [])
        report["metadata"]["signal_definitions"] = {
            name: definition for name, (pid, definition) in SIGNAL_DEFINITIONS.items()
            if (pid is None or pid in supported) and any(reading.get(name) is not None for reading in report["readings"])
        }
        if report["metadata"]["provenance"] is not None:
            report["metadata"]["provenance"]["sha256"] = hashlib.sha256(csv_bytes).hexdigest()
        args.output.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"mode": report["mode"], "samples": len(report["readings"]), "csv": str(args.output),
                      "json": str(args.output.with_suffix(".json")), "errors": report["errors"]}, ensure_ascii=False))
    return 1 if operation_error or report["errors"] else 0


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.action is None:
        parser.print_help()
        return 0
    if args.action == "integrations":
        print(json.dumps(integration_records(), ensure_ascii=False, indent=2))
        return 0
    try:
        return asyncio.run(acquire(args))
    except (ValueError, OSError, DiagnosticsError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Aquisição interrompida pelo usuário.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
