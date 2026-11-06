from auto_ecu_lab.reports import csv_bytes, svg_chart


def test_export_prevents_spreadsheet_formula_execution():
    content = csv_bytes(["texto"], [["=1+1"], ["+SUM(A1)"], ["@DADO"], ["normal"]]).decode("utf-8-sig")
    assert "'=1+1" in content
    assert "'+SUM(A1)" in content
    assert "'@DADO" in content
    assert "normal" in content


def test_standalone_chart_has_no_remote_dependencies(step_samples):
    chart = svg_chart(step_samples)
    assert '<svg xmlns="http://www.w3.org/2000/svg"' in chart
    assert "<polyline" in chart
    assert "<script" not in chart
    assert "href=" not in chart
