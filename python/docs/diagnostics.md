# Diagnóstico real documentado — AUTO ECU LAB

O pacote `auto_ecu_lab.diagnostics` é separado de `simulation.py` e não depende dos geradores de demonstração. Importar o pacote, construir um transporte ou abrir a interface de análise **não conecta um dispositivo**. A conexão real é iniciada explicitamente pelo cliente Python ou pelo subcomando `read`.

## Escopo entregue

- ELM327 com protocolo ASCII e respostas **CAN 11/29 bits**, incluindo remontagem ISO-TP e cabeçalhos de origem. Há testes automatizados com respostas fictícias; nenhum hardware foi conectado ou validado nesta implementação.
- Serial por USB ou porta COM de Bluetooth Classic já pareado pelo sistema, usando `pyserial` opcional. O programa não realiza pareamento Bluetooth Classic e não presume que o iOS ofereça uma porta serial.
- ELM327 Wi-Fi por **TCP nativo**, com host e porta explicitamente fornecidos conforme o manual. Não é HTTP, WebSocket, acesso a serviço remoto ou conexão TCP disponível diretamente na PWA.
- BLE GATT por `bleak` opcional em sistema nativo compatível, com endereço/identificador e UUIDs completos de serviço, RX e TX obtidos da documentação do adaptador. **Não existe um perfil BLE universal ELM327 presumido.** Este cliente Python não acrescenta Web Bluetooth ao Safari/iOS.
- Operação somente leitura: descoberta de PIDs, RPM, borboleta, pedal, VIN, identificação de calibração e DTCs. Nenhuma integração proprietária ou função de programação está implementada.

As capacidades efetivas dependem do sistema, driver, adaptador, protocolo e veículo. Ser um modelo cadastrado (Hilux, SW4, Strada, S10, Ranger, L200 ou Amarok) não comprova disponibilidade de um PID ou cobertura de módulos proprietários. OBD-II genérico não equivale a diagnóstico completo de ABS, airbag ou todos os módulos.

## Consultas e bloqueios

O validador aceita somente:

| Serviço | Consultas |
| --- | --- |
| `01` | Páginas de PIDs suportados `00,20,40,60,80,A0,C0,E0`; `0C` RPM; `11` abertura absoluta da borboleta; `49` posição D do pedal |
| `09` | `00` disponibilidade; `02` VIN; `04` CALID; `06` CVN |
| `03`, `07`, `0A` | DTCs armazenados, pendentes e permanentes |

Serviço `04` (apagar DTC), comandos UDS de escrita, atuação, desbloqueio de segurança, programação e comandos arbitrários são recusados **antes de qualquer I/O**. Não existe console AT aberto. A inicialização interna usa uma sequência fixa `ATZ`, `ATE0`, `ATL0`, `ATS1`, `ATH1`, `ATCAF1`, `ATCFC1`, `ATSP0`: são configurações do **adaptador ELM327**, não gravação de calibração da ECU. Não inclui limpeza de DTCs nem alteração de segurança ou emissões.

O decodificador rejeita quadros incompletos, sequência ISO-TP incorreta, DLC inconsistente, respostas de outro serviço e tamanhos inválidos. O retorno negativo `7F` mantém ECU, serviço e NRC. `NO DATA` não equivale a sinal zero nem a “sem DTC”. Protocolos legados ISO9141/J1850/KWP e mensagens J1939 exigem um adaptador/decoder específico futuro; não são adivinhados a partir de bytes de uma resposta desconhecida.

Quando várias ECUs respondem, é obrigatório selecionar uma origem, por exemplo `7E8`. Não se concatenam VINs ou amostras de módulos diferentes. VIN, CALID e CVN são registrados separadamente; não confirmam automaticamente fabricante, família, HW ou número de peça da ECU.

## Executar no computador

Na pasta do projeto Python e com o ambiente virtual ativo:

```bash
python -m pip install pyserial  # somente para serial USB/Bluetooth Classic
python -m pip install bleak     # somente para BLE nativo
python -m auto_ecu_lab.diagnostics integrations
```

A listagem não abre uma conexão. Para iniciar consultas reais, use explicitamente `read`. Exemplos com valores que **devem ser substituídos pelos documentados para seu dispositivo**:

```bash
python -m auto_ecu_lab.diagnostics read --transport serial --device COM3 --baudrate 38400 --ecu 7E8 --duration 10 --output captura.csv
python -m auto_ecu_lab.diagnostics read --transport wifi --host 192.0.2.10 --port 12345 --ecu 7E8 --duration 10 --output captura.csv
```

`192.0.2.10` é um endereço de exemplo, não um padrão ELM327. Se não informar `--ecu` e houver várias respostas, a aquisição informa as origens e encerra, em vez de escolher silenciosamente a primeira.

BLE requer quatro valores do fabricante, sem UUIDs presumidos:

```text
python -m auto_ecu_lab.diagnostics read --transport ble --device IDENTIFICADOR_DO_ADAPTADOR --service-uuid UUID_DO_SERVICO --rx-uuid UUID_DE_NOTIFICACOES --tx-uuid UUID_DE_ESCRITA --ecu 7E8 --output captura.csv
```

Esses nomes são marcadores, não comandos prontos para executar. O modo padrão de TX é escrita com resposta; `--ble-without-response` deve ser usado somente quando o fabricante documentar esse modo. Os UUIDs precisam pertencer ao serviço configurado e oferecer as propriedades esperadas. Host TCP, porta, baudrate, drivers e UUIDs não são determinados pelo nome do veículo.

`--timeout` controla a espera de resposta (0,1–60 s); `--interval` é uma pausa entre ciclos, não promessa de frequência. Os canais são consultados sequencialmente. Um timeout encerra a sessão para não associar uma resposta tardia à solicitação seguinte.

## Dados reais e gráficos

A coleta produz `captura.csv` e `captura.json`, identificados como `real_read_only` e `is_demo: false`. Esses rótulos, isoladamente, não tornam um registro elegível para a base estatística. O JSON mantém descoberta, origem da ECU, VIN/CALID/CVN, DTCs e erros. Cada leitura tem timestamp relativo e horários por canal; estes permitem avaliar o atraso introduzido pela aquisição sequencial.

`metadata.capture_id` é um UUID de cada sessão. `metadata.connection.started_at` e `started_at_utc` registram o mesmo instante UTC após a conexão bem-sucedida; não substituem o horário de cada canal. `connection.adapter` é preenchido somente depois da inicialização ELM327 validada. `connection.ecuId` e `metadata.identity.ecuId` vêm exclusivamente de `discovery.source`, a origem recebida no protocolo; não são copiados de `--ecu`, VIN ou cadastro manual.

Após a descoberta de uma origem, `metadata.provenance` usa o contrato de versão 1:

```json
{
  "schema_version": 1,
  "kind": "scanner_capture",
  "source": "ELM327 · aquisição OBD-II somente leitura",
  "captured_at": "<mesmo instante ISO 8601 com fuso de connection.started_at>",
  "verification": "protocol_capture",
  "reference": "<metadata.capture_id>",
  "sha256": "<SHA-256 dos bytes exatos de captura.csv>"
}
```

O hash inclui o BOM UTF-8, o cabeçalho e as linhas do CSV gravado; não é calculado sobre o JSON. Uma captura interrompida preserva somente as leituras concluídas e calcula o hash desse CSV parcial. Falhas antes da descoberta mantêm `provenance: null`, sem identidade de ECU inventada. `protocol_capture` descreve a origem dos dados pelo cliente; não certifica precisão do scanner, autenticidade do adaptador ou compatibilidade física já validada.

`metadata.signal_definitions` declara as definições OBD-II dos canais anunciados pela ECU e com pelo menos um valor recebido. Os identificadores canônicos são `time_s: "monotonic_seconds"`, `pedal_pct: "OBD-II 01 49 percent"` (posição D), `throttle_pct: "OBD-II 01 11 percent"` (borboleta absoluta) e `rpm: "OBD-II 01 0C rpm"`. Um canal ausente não recebe definição presumida. As estatísticas devem separar definições de sinais e coortes diferentes; registros incompletos não fornecem uma referência comparável de atraso.

Um PID ausente ou sem resposta fica `null` no JSON e vazio no CSV, acompanhado de observação. **Não se usa um canal simulado, não se copia outro canal e não se preenche com zero.** O importador de análise existente exige tempo/pedal/borboleta/RPM completos e rejeitará um CSV cuja aquisição esteja incompleta. Essa rejeição é intencional: o usuário deve investigar a disponibilidade dos sinais ou usar uma análise que aceite explicitamente dados esparsos no futuro.

O adaptador preserva somente dados recebidos. Mesmo uma leitura válida não certifica a precisão temporal do scanner, a definição exata do PID ou uma hipótese de defeito. As regras exploratórias de atraso continuam independentes da operação de diagnóstico.

## Scanners proprietários e expansão

O registro `diagnostics.registry.INTEGRATIONS` informa o estado da integração, não uma promessa de conexão:

- **J2534:** aguardando driver/DLL do fabricante, arquitetura 32/64 bits compatível e implementação de Pass-Thru. Nenhuma DLL é carregada automaticamente e não existe driver genérico embutido.
- **Rasther III/S:** aguardando SDK/API e autorização. O fluxo CSV preservado continua disponível; o projeto não implementa nem tenta deduzir o protocolo proprietário.
- **Outros scanners:** SDK, licença e adaptador específico exigidos. Não tratar um dispositivo como ELM327 apenas por usar Bluetooth, Wi-Fi ou USB.

Novos adaptadores devem implementar a interface assíncrona de transporte e produzir respostas com origem e proveniência, preservando a barreira de comandos de leitura. SDKs proprietários devem ter seus próprios adaptadores e testes; não devem habilitar serviços de escrita por meio de um console universal.

## Verificação

```bash
python -m pytest -q tests/test_diagnostics_obd.py tests/test_diagnostics_session.py tests/test_diagnostics_transports.py tests/test_capture_provenance.py
```

Os testes verificam parser CAN/ISO-TP, múltiplas ECUs, VIN, CALID/CVN, contador CAN de DTCs, bloqueio de escrita/injeção, timeout, ausência de dados e transportes com substitutos em memória. Não fazem descoberta Bluetooth, não abrem portas reais e não conectam Wi-Fi. É necessária validação com adaptadores e veículos físicos para declarar compatibilidade operacional.

Referências: [datasheet oficial ELM327](https://www.elmelectronics.com/wp-content/uploads/2017/01/ELM327DS.pdf), [documentação pySerial](https://pyserial.readthedocs.io/en/latest/pyserial_api.html), [documentação Bleak](https://bleak.readthedocs.io/en/latest/api/client.html). O datasheet ELM327 diferencia o contador adicional de DTC do protocolo CAN das respostas legadas; o decoder mantém essa distinção em vez de aplicar o formato legado aos bytes CAN.
