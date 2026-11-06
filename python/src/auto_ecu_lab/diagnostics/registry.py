"""Capacidades de integração; registrar um SDK não significa implementá-lo."""
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Integration:
    id: str
    name: str
    status: str
    platforms: tuple[str, ...]
    requirement: str
    hardware_verified: bool = False


INTEGRATIONS = (
    Integration("elm327", "ELM327 documentado", "implementado_sem_validação_em_hardware",
                ("Windows", "Linux", "macOS"),
                "Adaptador legítimo com protocolo ASCII documentado; respostas CAN 11/29 bits. BLE exige UUIDs do fabricante."),
    Integration("j2534", "SAE J2534 Pass-Thru", "aguardando_driver_e_integração",
                ("Windows",),
                "Driver/DLL do fabricante, arquitetura 32/64 bits compatível e implementação autorizada do adaptador. Não há suporte J2534 operacional nesta versão."),
    Integration("rasther_iii_s", "Rasther III/S", "aguardando_integração_autorizada",
                ("Windows", "Android", "iOS"),
                "SDK/API e autorização do fabricante. A importação CSV existente continua disponível; não há protocolo proprietário implementado."),
    Integration("vendor_sdk", "Outros scanners", "aguardando_sdk",
                ("Windows", "Android", "iOS"),
                "SDK/documentação, licença e adaptador específico. Não reutilizar o protocolo ELM327 sem confirmação do fabricante."),
)


def integration_records() -> list[dict]:
    return [asdict(integration) for integration in INTEGRATIONS]
