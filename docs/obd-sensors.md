# Sensores OBD-II — consulta pontual de leitura

A versão web oferece `ElmSession.readSensors()` separadamente da coleta de pedal, borboleta e RPM. A inicialização descobre os PIDs oferecidos pela ECU selecionada; consultar sensores exige o botão **Ler sensores**, após conectar um ELM327 documentado. Nenhuma consulta adicional é iniciada ao abrir o aplicativo ou iniciar a coleta do acelerador.

| Consulta Mode 01 | Canal | Unidade | Conversão dos bytes recebidos |
| --- | --- | --- | --- |
| `0104` | Carga calculada do motor | % | `A × 100 / 255` |
| `0105` | Temperatura do líquido de arrefecimento | °C | `A − 40` |
| `010B` | Pressão absoluta do coletor | kPa | `A` |
| `010D` | Velocidade informada pela ECU | km/h | `A` |
| `010F` | Temperatura do ar de admissão | °C | `A − 40` |
| `0110` | Fluxo de massa de ar | g/s | `(256 × A + B) / 100` |
| `0142` | Tensão do módulo | V | `(256 × A + B) / 1000` |

Os bytes A/B são dados de resposta, sem o cabeçalho de serviço/PID nem o PCI ISO-TP. A tensão `0142` vem da ECU; não é a tensão medida pelo adaptador ELM327. As máscaras `0100`, `0120` e `0140` determinam disponibilidade. Um PID não oferecido não é consultado.

## Dados e limites

Cada snapshot contém `ecuId`, `sourceMode`, data UTC de consulta, tempo monotônico desde a conexão, `sensors` e `errors`. Cada sensor preserva PID, canal, unidade, ECU de origem, valor, estado (`ok`, `unsupported` ou `error`), tempo observado, duração da consulta e bytes recebidos. Ausência, resposta truncada ou erro mantêm `value: null`; zero recebido permanece zero. O erro fica registrado sem aproveitar respostas de outra ECU.

São consultas sequenciais; os valores não constituem uma medição simultânea. Uma leitura por si só não confirma defeito nem especificações de fábrica. Não há cobertura presumida por marca, modelo ou motorização. O perfil web continua limitado a ISO 15765-4 CAN de 11 bits (protocolos ELM 6/8), com cabeçalhos e seleção de uma ECU respondente. O catálogo operacional mostra somente o adaptador implementado. J2534, comunicação direta Rasther III/S e outros SDKs não são apresentados como conectores disponíveis.

O último snapshot permanece na memória da sessão, inclusive após desconectar. Pode ser exportado no registro JSON real (`sensor_snapshot`) mesmo sem amostras de pedal. Ao salvar uma coleta completa, a mesma estrutura segue em `metadata.sensor_snapshot`. Os valores adicionais não são inseridos nas amostras de pedal, na simulação nem nas estatísticas de atraso. Nova conexão e descarte limpam o snapshot da sessão anterior, com a proteção já existente contra descarte de dados não salvos. Exportar prepara um arquivo; não confirma sua gravação no armazenamento externo do celular.

Esta expansão aplica-se ao navegador. O componente Python conserva seus canais de aquisição existentes; não foi acrescentada uma opção CLI de sensores adicionais nesta versão. Bluetooth BLE/serial dependem da API do navegador e da documentação do adaptador. Wi-Fi TCP permanece no componente Python; o site não abre TCP bruto nem instala uma ponte local.

A allowlist continua bloqueando apagar DTC (Mode 04), atuação, programação e comandos arbitrários. Nenhuma rotina de escrita foi adicionada.

## Fontes e verificação

- [Tabela de comandos do projeto python-OBD](https://python-obd.readthedocs.io/en/latest/Command%20Tables/): nomes, modos, PIDs e unidades dos sinais.
- [Decodificadores python-OBD, revisão a378bdd81d58c67d08050e4244173a9a7dbda73d](https://github.com/brendan-w/python-OBD/blob/a378bdd81d58c67d08050e4244173a9a7dbda73d/obd/decoders.py): conferência das conversões numéricas; referência técnica, sem incorporar código ou dependência dessa biblioteca.
- [Datasheet ELM327, Elm Electronics](https://www.elmelectronics.com/wp-content/uploads/2017/01/ELM327DS.pdf): transporte do adaptador, apresentação das respostas e consultas OBD.

Implementação original local, com vetores de bytes sintéticos exclusivamente nos testes. Os testes verificam conversões conhecidas, disponibilidade pelas máscaras, zero válido versus ausência, origem ECU, respostas inválidas, isolamento da coleta de pedal, bloqueio de comandos e exportação/estado da interface. Não houve conexão física a scanner/veículo nem validação Safari/Chrome nesta etapa.
