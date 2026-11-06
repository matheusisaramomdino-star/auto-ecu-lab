"""Transportes opcionais. Construir uma instância não abre o dispositivo."""
import asyncio
import math
from typing import Protocol
from uuid import UUID

from .errors import TransportError


class Transport(Protocol):
    async def open(self) -> None: ...
    async def write(self, data: bytes) -> None: ...
    async def read(self) -> bytes: ...
    async def close(self) -> None: ...


def _timeout(value: float) -> float:
    if not math.isfinite(value) or not 0.1 <= value <= 60:
        raise ValueError("Timeout deve estar entre 0,1 e 60 segundos.")
    return value


class SerialTransport:
    """USB serial ou porta COM de Bluetooth Classic já pareado no sistema.

    Não faz descoberta/pareamento Classic e não declara compatibilidade iOS.
    """
    def __init__(self, port: str, baudrate: int = 38400, timeout: float = 5):
        if not port or not isinstance(baudrate, int) or not 1200 <= baudrate <= 1000000:
            raise ValueError("Informe porta serial e baudrate documentados pelo adaptador.")
        self.port, self.baudrate, self.timeout = port, baudrate, _timeout(timeout)
        self._serial = None

    async def open(self):
        if self._serial is not None:
            raise TransportError("A porta serial já está aberta.")
        try:
            import serial
        except ImportError as exc:
            raise TransportError("Transporte serial requer a dependência opcional pyserial.") from exc
        try:
            self._serial = await asyncio.to_thread(serial.Serial, port=self.port, baudrate=self.baudrate,
                                                   timeout=0.1, write_timeout=self.timeout)
        except Exception as exc:
            raise TransportError("Não foi possível abrir a porta serial. Verifique porta, driver e permissões.") from exc

    async def write(self, data):
        if self._serial is None:
            raise TransportError("Porta serial não conectada.")
        try:
            count = await asyncio.to_thread(self._serial.write, data)
            if count != len(data):
                raise TransportError("Escrita parcial no adaptador serial.")
        except TransportError:
            raise
        except Exception as exc:
            raise TransportError("Falha de comunicação com o adaptador serial.") from exc

    async def read(self):
        if self._serial is None:
            raise TransportError("Porta serial não conectada.")
        try:
            return await asyncio.to_thread(self._serial.read, 256)
        except Exception as exc:
            raise TransportError("Adaptador serial desconectado ou indisponível.") from exc

    async def close(self):
        device, self._serial = self._serial, None
        if device is not None:
            await asyncio.to_thread(device.close)


class WifiTransport:
    """TCP ASCII para ELM327 Wi-Fi documentado; não é HTTP nem API de nuvem."""
    def __init__(self, host: str, port: int, timeout: float = 5):
        if not isinstance(host, str) or not host.strip() or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError("Informe host e porta TCP documentados do adaptador.")
        self.host, self.port, self.timeout = host.strip(), port, _timeout(timeout)
        self._reader = self._writer = None

    async def open(self):
        if self._writer is not None:
            raise TransportError("A conexão TCP já está aberta.")
        try:
            self._reader, self._writer = await asyncio.wait_for(asyncio.open_connection(self.host, self.port), self.timeout)
        except (OSError, TimeoutError) as exc:
            raise TransportError("Não foi possível conectar ao ELM327 Wi-Fi. Verifique a rede, host e porta documentados.") from exc

    async def write(self, data):
        if self._writer is None:
            raise TransportError("Adaptador Wi-Fi não conectado.")
        try:
            self._writer.write(data)
            await asyncio.wait_for(self._writer.drain(), self.timeout)
        except (OSError, TimeoutError) as exc:
            raise TransportError("Falha ao enviar consulta ao adaptador Wi-Fi.") from exc

    async def read(self):
        if self._reader is None:
            raise TransportError("Adaptador Wi-Fi não conectado.")
        try:
            data = await self._reader.read(256)
        except OSError as exc:
            raise TransportError("Falha de leitura do adaptador Wi-Fi.") from exc
        if not data:
            raise TransportError("O adaptador Wi-Fi encerrou a conexão.")
        return data

    async def close(self):
        writer, self._reader, self._writer = self._writer, None, None
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass


class BleTransport:
    """GATT UART com UUIDs do fabricante; não presume um perfil ELM327 padrão.

    rx_uuid recebe notificações do scanner; tx_uuid aceita consultas ASCII.
    Exige Bleak em ambiente nativo. Não fornece BLE ao Safari/iOS pela PWA.
    """
    def __init__(self, address: str, service_uuid: str, rx_uuid: str, tx_uuid: str,
                 timeout: float = 5, write_response: bool = True):
        if not address or not isinstance(write_response, bool):
            raise ValueError("Informe o identificador do dispositivo BLE.")
        try:
            uuids = [str(UUID(value)) for value in (service_uuid, rx_uuid, tx_uuid)]
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("Informe UUIDs completos de serviço, RX e TX conforme a documentação do adaptador.") from exc
        self.address, self.timeout = address, _timeout(timeout)
        self.service_uuid, self.rx_uuid, self.tx_uuid = uuids
        self.write_response = write_response
        self._client = None
        self._queue = asyncio.Queue(maxsize=256)
        self._overflow = False

    async def open(self):
        if self._client is not None:
            raise TransportError("O dispositivo BLE já está conectado.")
        try:
            from bleak import BleakClient
        except ImportError as exc:
            raise TransportError("Transporte BLE requer a dependência opcional bleak e suporte Bluetooth do sistema.") from exc
        self._overflow = False
        self._queue = asyncio.Queue(maxsize=256)
        client = BleakClient(self.address, timeout=self.timeout)
        try:
            await client.connect()
            service = client.services.get_service(self.service_uuid)
            if service is None:
                raise TransportError("Serviço BLE informado não foi encontrado no dispositivo.")
            rx, tx = service.get_characteristic(self.rx_uuid), service.get_characteristic(self.tx_uuid)
            if rx is None or tx is None or not (set(rx.properties) & {"notify", "indicate"}):
                raise TransportError("As características RX/TX informadas não pertencem ao serviço ou RX não oferece notificações.")
            required = "write" if self.write_response else "write-without-response"
            if required not in tx.properties:
                raise TransportError("A característica TX não oferece o tipo de escrita configurado pelo fabricante.")
            def receive(_sender, value):
                try:
                    self._queue.put_nowait(bytes(value))
                except asyncio.QueueFull:
                    self._overflow = True
            await client.start_notify(rx, receive)
            self._client = client
        except Exception as exc:
            try:
                await client.disconnect()
            except Exception:
                pass
            if isinstance(exc, TransportError):
                raise
            raise TransportError("Não foi possível abrir o BLE. Confira UUIDs, permissões e documentação do adaptador.") from exc

    async def write(self, data):
        if self._client is None or not self._client.is_connected:
            raise TransportError("Adaptador BLE não conectado.")
        try:
            # Os comandos aceitos têm no máximo seis bytes e cabem no ATT MTU mínimo.
            await self._client.write_gatt_char(self.tx_uuid, data, response=self.write_response)
        except Exception as exc:
            raise TransportError("Falha ao enviar consulta ao adaptador BLE.") from exc

    async def read(self):
        if self._overflow:
            raise TransportError("Notificações BLE excederam o buffer; a leitura foi interrompida sem descartar dados silenciosamente.")
        if self._client is None or not self._client.is_connected:
            raise TransportError("Adaptador BLE desconectado.")
        return await self._queue.get()

    async def close(self):
        client, self._client = self._client, None
        if client is not None:
            try:
                await client.stop_notify(self.rx_uuid)
            finally:
                await client.disconnect()
