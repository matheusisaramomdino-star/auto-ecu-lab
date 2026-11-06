"""Interface local Flask, em português, independente dos módulos de análise."""
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import secrets

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename

from .analysis import AnalysisConfig, analyze
from .catalog import VEHICLE_PRESETS
from .importers import MAX_BYTES, import_diagnostics, import_signals
from .models import ECU, ValidationError, Vehicle
from .provenance import known_synthetic_hash, provenance_issue, scanner_report_provenance
from .reports import LIMITATIONS, csv_bytes, report_payload, svg_chart
from .simulation import SimulationConfig, simulate
from .storage import Repository
from .statistics import real_statistics


def create_app(config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("AUTO_ECU_SECRET") or secrets.token_hex(32),
        DATABASE=os.environ.get("AUTO_ECU_DATABASE", str(Path.cwd() / "instance" / "auto_ecu_lab.sqlite3")),
        MAX_CONTENT_LENGTH=11 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Strict",
    )
    if config:
        app.config.update(config)
    repo = Repository(app.config["DATABASE"])
    app.extensions["repository"] = repo

    @app.before_request
    def check_csrf():
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_hex(32)
        if request.method == "POST":
            token = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token", "")
            if not hmac.compare_digest(token, session["csrf_token"]):
                abort(400, "Formulário expirado. Atualize a página e tente novamente.")

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.context_processor
    def common():
        return {"csrf_token": session.get("csrf_token", ""), "limitations": LIMITATIONS}

    @app.template_filter("br")
    def number(value, digits=2):
        return "—" if value is None else f"{value:.{digits}f}".replace(".", ",")

    @app.template_filter("local_time")
    def local_time(value):
        # Manaus usa UTC−4; manter os metadados técnicos originais em UTC no JSON.
        return datetime.fromisoformat(value).astimezone(timezone(timedelta(hours=-4))).strftime("%d/%m/%Y %H:%M:%S") + " · Manaus (UTC−4)"

    def get_recording(recording_id):
        recording = repo.recording(recording_id)
        if recording is None:
            abort(404, "Ensaio não encontrado.")
        return recording

    def current_recording():
        items = repo.recordings()
        selected = request.args.get("ensaio", type=int)
        return get_recording(selected) if selected else get_recording(items[0]["id"]) if items else None

    def result_for(recording):
        return analyze(recording["samples"], recording["diagnostics"], recording["analysis_config"])

    def provenance(content, filename):
        return {"filename": secure_filename(filename or "relatorio.csv"), "sha256": hashlib.sha256(content).hexdigest()}

    @app.get("/")
    def dashboard():
        recording = current_recording()
        result = result_for(recording) if recording else None
        chart = {"samples": [asdict(s) for s in recording["samples"]], "events": [asdict(e) for e in result.events]} if recording else None
        return render_template("dashboard.html", page="analysis", recording=recording, result=result, chart=chart, recordings=repo.recordings())

    @app.route("/veiculos", methods=["GET", "POST"])
    def vehicles():
        if request.method == "POST":
            try:
                ecu = ECU(*(request.form.get(k, "").strip() for k in ("manufacturer", "identification", "hardware", "software")),
                          request.form.get("ecu_source", "").strip() or "Não confirmada")
                if not ecu.identification and ecu.source != "Não confirmada":
                    raise ValidationError("Informe a identificação da ECU ou deixe a origem como não confirmada.")
                vehicle = Vehicle(request.form.get("brand", "").strip(), request.form.get("model", "").strip(),
                                  int(request.form.get("year", "0")), request.form.get("engine", "").strip(),
                                  request.form.get("plate", "").strip(), ecu)
                repo.add_vehicle(vehicle)
                flash("Veículo e identificação da ECU cadastrados.", "success")
                return redirect(url_for("vehicles"))
            except (ValueError, ValidationError) as exc:
                flash(str(exc) if isinstance(exc, ValidationError) else "Informe um ano válido.", "error")
        return render_template("vehicles.html", page="vehicles", vehicles=repo.vehicles(), vehicle_presets=VEHICLE_PRESETS)

    @app.route("/importar", methods=["GET", "POST"])
    def imports():
        if request.method == "POST":
            try:
                vehicle_id = request.form.get("vehicle_id", type=int)
                if not vehicle_id or not repo.vehicle(vehicle_id):
                    raise ValidationError("Selecione um veículo cadastrado.")
                upload = request.files.get("signals")
                if not upload or not upload.filename or not upload.filename.lower().endswith(".csv"):
                    raise ValidationError("Selecione um arquivo CSV de parâmetros.")
                content = upload.read(MAX_BYTES + 1)
                mapping = {k: request.form.get(k, "") for k in ("time_s", "pedal_pct", "throttle_pct", "rpm")}
                parsed = import_signals(content, mapping, request.form.get("time_unit", "auto"))
                title = request.form.get("title", "").strip() or "Ensaio importado"
                if len(title) > 150:
                    raise ValidationError("O título aceita até 150 caracteres.")
                diagnostic_upload = request.files.get("diagnostics")
                codes, diagnostic_meta = [], None
                if diagnostic_upload and diagnostic_upload.filename:
                    diagnostic_content = diagnostic_upload.read(MAX_BYTES + 1)
                    codes = import_diagnostics(diagnostic_content)
                    diagnostic_meta = provenance(diagnostic_content, diagnostic_upload.filename)
                if request.form.get("is_demo") == "on":
                    raise ValidationError("Dados fictícios não são aceitos na base de medições reais.")
                file_proof = provenance(content, upload.filename)
                captured_at = request.form.get("captured_at", "").strip()
                try:
                    date = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
                    if date.tzinfo is None:
                        offset = request.form.get("capture_timezone", "")
                        if offset not in ("-04:00", "-03:00", "+00:00"):
                            raise ValueError
                        captured_at += offset
                except ValueError:
                    raise ValidationError("Informe a data real da captura e seu fuso horário.") from None
                proof = scanner_report_provenance(source=request.form.get("measurement_source", ""),
                    captured_at=captured_at, reference=file_proof["filename"], sha256=file_proof["sha256"],
                    confirmed=request.form.get("real_data") == "on")
                metadata = {**file_proof, "source": proof["source"], "provenance": proof,
                            "mapping": parsed.mapping, "encoding": parsed.encoding, "delimiter": parsed.delimiter,
                            "time_unit": request.form.get("time_unit", "auto")}
                definitions = {key: request.form.get("definition_" + key, "").strip()
                               for key in ("time_s", "pedal_pct", "throttle_pct", "rpm")}
                if any(definitions.values()):
                    metadata["signal_definitions"] = {key: value for key, value in definitions.items() if value}
                if diagnostic_meta:
                    metadata["diagnostic_report"] = diagnostic_meta
                if provenance_issue(metadata) == "dados_ficticios_conhecidos":
                    raise ValidationError("Arquivo de demonstração conhecido: dados fictícios não são aceitos como medições reais.")
                recording_id = repo.add_recording(vehicle_id, title, secure_filename(upload.filename), parsed.samples, metadata, diagnostics=codes)
                flash(f"Importação concluída: {len(parsed.samples)} amostras validadas.", "success")
                return redirect(url_for("dashboard", ensaio=recording_id))
            except ValidationError as exc:
                flash(str(exc), "error")
        return render_template("imports.html", page="imports", vehicles=repo.vehicles(), recordings=repo.recordings())

    def statistics_payload():
        payload = real_statistics(repo.recording(item["id"]) for item in repo.recordings())
        payload["counts"]["archived_demo"] = repo.archive_count()
        return payload

    @app.get("/estatisticas")
    def statistics():
        return render_template("statistics.html", page="statistics", statistics=statistics_payload())

    @app.get("/api/estatisticas")
    def statistics_api():
        return jsonify(statistics_payload())

    @app.post("/ensaios/<int:recording_id>/parametros")
    def parameters(recording_id):
        get_recording(recording_id)
        try:
            config = AnalysisConfig(**{k: float(request.form[k].replace(",", ".")) for k in asdict(AnalysisConfig())})
            repo.set_analysis_config(recording_id, config)
            flash("Limiares da análise atualizados. Os relatórios usarão estes valores.", "success")
        except (KeyError, ValueError) as exc:
            flash(str(exc) if isinstance(exc, ValidationError) else "Parâmetros inválidos.", "error")
        return redirect(url_for("dashboard", ensaio=recording_id))

    @app.post("/ensaios/<int:recording_id>/dtc")
    def diagnostics(recording_id):
        get_recording(recording_id)
        try:
            upload = request.files.get("diagnostics")
            if not upload or not upload.filename:
                raise ValidationError("Selecione o relatório DTC CSV.")
            content = upload.read(MAX_BYTES + 1)
            codes = import_diagnostics(content)
            file_proof = provenance(content, upload.filename)
            if known_synthetic_hash(file_proof["sha256"]):
                raise ValidationError("Relatório DTC de demonstração conhecido: não pode ser associado a uma medição real.")
            repo.set_diagnostics(recording_id, codes, file_proof)
            flash(f"Relatório associado ao ensaio: {len(codes)} DTC(s).", "success")
        except ValidationError as exc:
            flash(str(exc), "error")
        return redirect(url_for("dashboard", ensaio=recording_id))

    @app.get("/simulador")
    def simulator():
        recording = current_recording()
        chart = {"samples": [asdict(s) for s in recording["samples"]]} if recording else None
        return render_template("simulator.html", page="simulator", recording=recording, chart=chart, recordings=repo.recordings())

    @app.post("/api/ensaios/<int:recording_id>/simular")
    def simulation(recording_id):
        recording = get_recording(recording_id)
        try:
            data = request.get_json(silent=True) or {}
            if not isinstance(data, dict):
                raise ValidationError("Envie um objeto JSON com os parâmetros da simulação.")
            config = SimulationConfig(**{k: float(data.get(k, v)) for k, v in asdict(SimulationConfig()).items()})
            values = simulate(recording["samples"], config)
            if data.get("download"):
                rows = ((s.time_s, s.pedal_pct, s.throttle_pct, v["simulated_throttle_pct"], s.rpm,
                         config.delay_s, config.tau_s, config.gamma, config.maximum_pct)
                        for s, v in zip(recording["samples"], values))
                content = csv_bytes(["tempo_s", "pedal_pct", "borboleta_medida_pct", "borboleta_simulada_pct", "rpm_medido",
                                     "atraso_modelo_s", "tau_modelo_s", "expoente_modelo", "abertura_maxima_modelo_pct"], rows)
                response = send_file(io.BytesIO(content), mimetype="text/csv", as_attachment=True, download_name=f"simulacao_ensaio_{recording_id}.csv")
                response.headers["X-Auto-ECU-Simulation"] = json.dumps(asdict(config))
                return response
            return jsonify({"values": values, "config": asdict(config), "notice": "Simulação didática. Não estima torque, RPM nem comportamento real da ECU."})
        except (ValueError, TypeError) as exc:
            return jsonify(error=str(exc) if isinstance(exc, ValidationError) else "Parâmetros inválidos."), 400

    @app.get("/relatorios")
    def reports():
        return render_template("reports.html", page="reports", recordings=repo.recordings())

    @app.get("/ensaios/<int:recording_id>/relatorio.<format>")
    def report(recording_id, format):
        recording = get_recording(recording_id)
        result = result_for(recording)
        payload = report_payload(recording, result)
        if format == "html":
            html = render_template("report.html", recording=recording, result=result, payload=payload,
                                   static_chart=svg_chart(recording["samples"])).encode("utf-8")
            return send_file(io.BytesIO(html), mimetype="text/html", as_attachment=True, download_name=f"auto_ecu_lab_ensaio_{recording_id}.html")
        if format == "json":
            return send_file(io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False).encode()),
                             mimetype="application/json", as_attachment=True, download_name=f"auto_ecu_lab_ensaio_{recording_id}.json")
        if format == "csv":
            rows = ((s.time_s, s.pedal_pct, s.throttle_pct, s.rpm) for s in recording["samples"])
            return send_file(io.BytesIO(csv_bytes(["tempo_s", "pedal_pct", "throttle_pct", "rpm"], rows)),
                             mimetype="text/csv", as_attachment=True, download_name=f"dados_ensaio_{recording_id}.csv")
        abort(404)

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(error):
        return render_template("error.html", message="Arquivos grandes demais. Cada CSV pode ter até 5 MB; o envio completo deve ter até 11 MB."), 413

    @app.errorhandler(400)
    @app.errorhandler(404)
    def user_error(error):
        if request.path.startswith("/api/"):
            return jsonify(error=error.description), error.code
        return render_template("error.html", message=error.description), error.code

    return app
