import pytest

from auto_ecu_lab.diagnostics.errors import AmbiguousECUError, NegativeResponseError, NoDataError, ProtocolError, ReadOnlyViolation
from auto_ecu_lab.diagnostics.obd import Message, decode_dtc, decode_response, parse_elm_response, select_message, validate_request


def can_response(payload: bytes, source="7E8"):
    if len(payload) <= 7:
        return f"{source} {len(payload):02X} " + payload.hex(" ").upper()
    length = len(payload)
    frames = [f"{source} {0x10 | (length >> 8):02X} {length & 255:02X} " + payload[:6].hex(" ").upper()]
    for i, offset in enumerate(range(6, length, 7), 1):
        frames.append(f"{source} {0x20 | (i & 15):02X} " + payload[offset:offset + 7].hex(" ").upper())
    return "\r".join(frames)


@pytest.mark.parametrize("query", ["0100", "0120", "0140", "010C", "01 11", "0149", "0900", "0902", "0904", "0906", "03", "07", "0A"])
def test_only_documented_read_requests_are_allowed(query):
    assert validate_request(query) == query.replace(" ", "").upper()


@pytest.mark.parametrize("query", ["04", "0801", "1001", "2701", "2EF190", "3101", "34", "ATZ", "ATSH7E0", "010C\r04", "010C\n04", "010C00", "0110", "0903", None])
def test_writes_arbitrary_at_and_command_injection_are_blocked(query):
    with pytest.raises(ReadOnlyViolation):
        validate_request(query)


def test_chunk_agnostic_can_payloads_decode_physical_units():
    rpm = parse_elm_response("010C\rSEARCHING...\r7E8 04 41 0C 1A F8\r>", "010C")
    assert decode_response(rpm[0], "010C") == 1726
    assert decode_response(parse_elm_response("7E8 03 41 11 80", "0111")[0], "0111") == pytest.approx(50.1960784314)
    assert decode_response(parse_elm_response("7E8 03 41 49 40", "0149")[0], "0149") == pytest.approx(25.0980392157)


@pytest.mark.parametrize("response", ["7E8 04 41 0C 1A F8", "7E804410C1AF8", "18DAF110 04 41 0C 1A F8", "18DAF11004410C1AF8", "18 DA F1 10 04 41 0C 1A F8", "7E8 5 04 41 0C 1A F8"])
def test_can_11_and_29_bit_headers_with_optional_dlc(response):
    message = parse_elm_response(response, "010C")[0]
    assert message.source in {"7E8", "18DAF110"}
    assert decode_response(message, "010C") == 1726


def test_multiple_ecus_are_not_silently_joined_or_chosen():
    messages = parse_elm_response("7E8 04 41 0C 1A F8\r7E9 04 41 0C 0F A0", "010C")
    with pytest.raises(AmbiguousECUError):
        select_message(messages)
    assert decode_response(select_message(messages, "7E9"), "010C") == 1000


def test_isotp_vin_reassembly_and_source_are_preserved():
    vin = "1HGBH41JXMN109186"
    response = can_response(b"\x49\x02\x01" + vin.encode())
    message = parse_elm_response(response, "0902")[0]
    assert message.source == "7E8"
    assert decode_response(message, "0902") == vin


def test_interleaved_isotp_never_concatenates_vins_from_two_ecus():
    first = can_response(b"\x49\x02\x01" + b"1HGBH41JXMN109186", "7E8").split("\r")
    second = can_response(b"\x49\x02\x01" + b"WVWZZZ1JZXW000001", "7E9").split("\r")
    response = "\r".join(line for pair in zip(first, second) for line in pair)
    messages = parse_elm_response(response, "0902")
    assert decode_response(select_message(messages, "7E8"), "0902") == "1HGBH41JXMN109186"
    assert decode_response(select_message(messages, "7E9"), "0902") == "WVWZZZ1JZXW000001"


@pytest.mark.parametrize("response", [
    "7E8 10 14 49 02 01 31 48 47",  # sem quadros consecutivos
    "7E8 10 14 49 02 01 31 48 47\r7E8 22 42 48 34 31 4A 58 4D",  # sequência errada
    "7E8 10 08 43 03 01 33 02\r7E8 21 10 03 00",  # primeiro quadro com DLC menor que 8
    "7E8 10 14 49 02 01 31 48 47\r7E8 21 42 48\r7E8 22 34 31 4A 58 4D 4E 31",  # CF intermediário curto
    "7E8 21 31 32 33", "7E8 04 41 0C 1A", "7E8 00", "7E8 30 00 00", "7E8 04 41 0C 1A F8\r7E8 04 41 0C 1A F8",
])
def test_truncated_or_out_of_sequence_can_is_rejected(response):
    with pytest.raises(ProtocolError):
        parse_elm_response(response, "0902")


def test_headerless_responses_require_explicit_can_confirmation():
    with pytest.raises(ProtocolError, match="sem identificação"):
        parse_elm_response("41 0C 1A F8", "010C")
    message = parse_elm_response("41 0C 1A F8", "010C", headerless_can=True)[0]
    assert message.source == "SEM_CABECALHO"
    assert decode_response(message, "010C") == 1726
    with pytest.raises(AmbiguousECUError):
        parse_elm_response("41 0C 1A F8\r41 0C 1A F8", "010C", headerless_can=True)


@pytest.mark.parametrize("response", ["NO DATA", "", "010C\r>"])
def test_missing_response_is_not_zero_or_empty_dtc_list(response):
    with pytest.raises(NoDataError):
        parse_elm_response(response, "010C")


@pytest.mark.parametrize("response", ["CAN ERROR", "UNABLE TO CONNECT", "STOPPED", "?", "BUS INIT: ERROR"])
def test_scanner_failures_remain_errors(response):
    with pytest.raises(ProtocolError):
        parse_elm_response(response, "010C")


def test_negative_response_keeps_service_nrc_and_ecu():
    message = parse_elm_response("7E8 03 7F 01 12", "010C")[0]
    with pytest.raises(NegativeResponseError) as error:
        decode_response(message, "010C")
    assert (error.value.source, error.value.service, error.value.code) == ("7E8", 1, 0x12)


def test_wrong_request_truncated_pid_and_incorrect_negative_response_fail():
    for message in [Message("7E8", b"\x41\x11\x80"), Message("7E8", b"\x41\x0C\x1A"), Message("7E8", b"\x7F\x09\x12")]:
        with pytest.raises(ProtocolError):
            decode_response(message, "010C")


def test_pid_bitmask_and_can_dtc_count_use_the_correct_positions():
    assert decode_response(Message("7E8", bytes.fromhex("410000100001")), "0100") == {0x0C, 0x20}
    assert decode_response(Message("7E8", bytes.fromhex("430201330134")), "03") == ["P0133", "P0134"]
    assert decode_response(Message("7E8", bytes.fromhex("430000000000")), "03") == []
    assert decode_dtc(0xD0, 0x16) == "U1016"


@pytest.mark.parametrize("payload", ["43", "43020133", "43000133", "43010000"])
def test_dtc_count_and_truncation_are_not_interpreted_as_no_fault(payload):
    with pytest.raises(ProtocolError):
        decode_response(Message("7E8", bytes.fromhex(payload)), "03")


def test_calid_and_cvn_are_returned_separately_without_inference():
    calid = b"EXAMPLE-CALID".ljust(16, b"\x00")
    assert decode_response(Message("7E8", b"\x49\x04\x01" + calid), "0904") == ["EXAMPLE-CALID"]
    assert decode_response(Message("7E8", bytes.fromhex("49060212345678ABCDEF01")), "0906") == ["12345678", "ABCDEF01"]
    with pytest.raises(ProtocolError):
        decode_response(Message("7E8", b"\x49\x02\x01SHORT"), "0902")
