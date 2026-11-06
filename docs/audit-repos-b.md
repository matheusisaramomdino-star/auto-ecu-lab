# Auditoria de referências — grupo B

Inspeção em **6 de novembro de 2026**, em revisões fixadas. Os achados abaixo descrevem as evidências públicas examinadas; não certificam cobertura, funcionamento em hardware ou a situação jurídica de todos os componentes. Não foram executados programas de terceiros, instaladas dependências ou baixados firmware, dumps e mapas. Nenhum desses materiais entra no aplicativo.

| Repositório | Revisão | Licença identificada | Decisão |
| --- | --- | --- | --- |
| LibreTune | `0b9dd644c0f4ba0c58276e261616cee71a3c38dc` | GPL-2.0-only, com avisos de terceiros | Referência de organização; implementação independente |
| slowduino | `08536a8ab7b040bca2418fb43acff8dea876c928` | MIT e GPL v2 declaradas em arquivos distintos | Não incorporar até esclarecer o conflito |
| SCG-ECU | `1e25e7249d20044b5d39f70b28919943a0a5ae84` | CC NC sem versão/termos completos | Não incorporar firmware, mapas ou hardware |

## 1. RallyPat/LibreTune

**Plataforma observada:** Rust 2021, Tauri 2 e frontend React; portas seriais/TCP nativas no núcleo. README oferece desktop Linux/Windows/macOS e declara pré-lançamento.

**Licença e limites de reutilização**

- Cargo.toml declara license = GPL-2.0-only; LICENSE contém GNU GPL versão 2.
- THIRD_PARTY_NOTICES.md registra um componente MIT do simulador; não foi feita auditoria integral de dependências transitivas.

**Compatibilidade e evidências funcionais**

- README anuncia Speeduino, rusEFI, FOME, epicEFI e suporte parcial MegaSquirt; isso não comprova suporte OBD-II genérico nem cobertura das ECUs OEM do catálogo AUTO ECU LAB.
- protocol/commands.rs define parâmetros de leitura, escrita, burn e console; bytes de comandos vêm das definições INI, não de uma tabela universal.
- protocol/connection.rs contém canais serial/TCP e políticas de auto-burn; não é um núcleo exclusivamente de leitura.
- A documentação de protocolo apresenta exemplos simplificados e preenchimento com zeros em sincronização parcial; esses exemplos não devem ser tratados como dados reais nem contrato comum a todo firmware.
- Há código e documentação de tabelas 2D/3D, logs e simulador, mas frontend Tauri depende de IPC e não funciona como adaptador PWA apenas copiando componentes.
- Cargo.lock está presente e não há submódulos Git na árvore auditada; existência de lock/CI não comprova validação física ou licenças transitivas completas.

**Decisão:** Não incorporar código, INIs, mapas, simulador nem runtime nesta entrega. Usar padrões genéricos de organização como referência para implementação independente de inspeção BIN/2D/3D e relatórios. Reuso futuro de componentes GPL exige analisar o componente concreto, obrigações de distribuição de fonte/avisos, dependências e licença compatível da obra resultante. Adaptador de ECU aftermarket só após protocolo/versionamento documentados e implementação isolada de leitura validada.

**Fontes na revisão auditada**

- [Árvore da revisão](https://github.com/RallyPat/LibreTune/tree/0b9dd644c0f4ba0c58276e261616cee71a3c38dc)
- [LICENSE](https://github.com/RallyPat/LibreTune/blob/0b9dd644c0f4ba0c58276e261616cee71a3c38dc/LICENSE)
- [Cargo.toml](https://github.com/RallyPat/LibreTune/blob/0b9dd644c0f4ba0c58276e261616cee71a3c38dc/Cargo.toml)
- [THIRD_PARTY_NOTICES.md](https://github.com/RallyPat/LibreTune/blob/0b9dd644c0f4ba0c58276e261616cee71a3c38dc/THIRD_PARTY_NOTICES.md)
- [README.md](https://github.com/RallyPat/LibreTune/blob/0b9dd644c0f4ba0c58276e261616cee71a3c38dc/README.md)
- [crates/libretune-app/src-tauri/Cargo.toml](https://github.com/RallyPat/LibreTune/blob/0b9dd644c0f4ba0c58276e261616cee71a3c38dc/crates/libretune-app/src-tauri/Cargo.toml)
- [crates/libretune-core/src/protocol/commands.rs](https://github.com/RallyPat/LibreTune/blob/0b9dd644c0f4ba0c58276e261616cee71a3c38dc/crates/libretune-core/src/protocol/commands.rs)
- [crates/libretune-core/src/protocol/connection.rs](https://github.com/RallyPat/LibreTune/blob/0b9dd644c0f4ba0c58276e261616cee71a3c38dc/crates/libretune-core/src/protocol/connection.rs)
- [docs/src/technical/ecu-protocol.md](https://github.com/RallyPat/LibreTune/blob/0b9dd644c0f4ba0c58276e261616cee71a3c38dc/docs/src/technical/ecu-protocol.md)

## 2. alexandrefelipemuller/slowduino

**Plataforma observada:** Firmware C++/Arduino para Uno/Nano/ATmega328P; platformio.ini também define Mega2560 e STM32F103 Blue Pill. Não é aplicativo PWA nem scanner ELM327.

**Licença e limites de reutilização**

- LICENSE contém texto MIT e copyright de Alexandre Felipe Muller de Souza.
- docs/contributing.md identifica o projeto como GNU GPL v2, associado à licença Speeduino. O conflito não foi resolvido apenas pelo rótulo MIT da API GitHub.
- Cabeçalhos dos fontes inspecionados descrevem arquivos sem esclarecer esse conflito; não se presume uma licença única para cópia.

**Compatibilidade e evidências funcionais**

- Firmware implementa leitura de ADC, injeção, ignição, armazenamento EEPROM/flash e protocolo TunerStudio; essas rotinas controlam o motor e não integram o escopo de diagnóstico de leitura.
- docs/communication-and-debug.md documenta comandos de consulta junto com escrita e burn EEPROM. Nenhuma ponte BLE/Wi-Fi/USB ou scanner OEM é fornecida para a PWA AUTO ECU LAB.
- A documentação afirma não distribuir INI, porém a árvore contém tunerstudio/slowduino_202402.ini.
- O cabeçalho do INI descreve assinatura slowduino 202402, mas seu campo signature e slowduino/comms.cpp usam speeduino 202402(s). Não basta o texto de apresentação para identificar firmware.
- O INI declara páginas de protocolo como stubs que retornam zeros/descartam escritas. Esses zeros não representam sensores ou calibrações medidos.
- Sensores.cpp lê canais ADC com conversões específicas do firmware/hardware; esses campos não equivalem a PIDs OBD-II padronizados.
- Não há submódulos Git na árvore auditada. Builds e experimentos de simulador existentes não foram executados nem usados como evidência de cobertura de veículos reais.

**Decisão:** Não incorporar código, INI ou tabelas enquanto a licença estiver contraditória. Não habilitar adaptador Slowduino nem pressupor assinatura, offsets ou unidade física. Eventual integração de bancada exige esclarecimento de licença, versão/assinatura verificadas, especificação de leitura, distinção explícita entre stubs e canais reais e testes de hardware autorizado. Manter no produto somente o ELM327 documentado já implementado.

**Fontes na revisão auditada**

- [Árvore da revisão](https://github.com/alexandrefelipemuller/slowduino/tree/08536a8ab7b040bca2418fb43acff8dea876c928)
- [LICENSE](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/LICENSE)
- [docs/contributing.md](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/docs/contributing.md)
- [README.md](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/README.md)
- [platformio.ini](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/platformio.ini)
- [docs/communication-and-debug.md](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/docs/communication-and-debug.md)
- [tunerstudio/slowduino_202402.ini](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/tunerstudio/slowduino_202402.ini)
- [slowduino/comms.cpp](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/slowduino/comms.cpp)
- [slowduino/sensors.cpp](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/slowduino/sensors.cpp)
- [slowduino/storage.cpp](https://github.com/alexandrefelipemuller/slowduino/blob/08536a8ab7b040bca2418fb43acff8dea876c928/slowduino/storage.cpp)

## 3. dvjcodec/SCG-ECU-2.0-STM32F407-8x8

**Plataforma observada:** Projeto de ECU standalone STM32F407 com arquivos de hardware/produção, firmware.bin, base-map.msq e speeduino.ini. Não há fonte de firmware C/C++ nem conector OBD-II na árvore auditada.

**Licença e limites de reutilização**

- LICENSE.md contém apenas a identificação CC NC / Creative Commons NonCommercial.
- README repete Creative Commons NonCommercial, sem indicar URI, versão ou termos completos; não se atribui SPDX específico.
- README agradece terceiro por firmware/base-map/INI; não foram verificadas concessões individuais ou licenças do firmware e mapas.

**Compatibilidade e evidências funcionais**

- README descreve oito saídas de injetores, oito saídas de ignição, atuadores, sensores e CAN físico; presença de CAN não comprova protocolo OBD-II, UDS ou compatibilidade OEM.
- Repositório contém firmware e mapa-base para uma ECU de reposição; arquivos não são medições de scanner e não alimentam estatísticas de resposta de veículos.
- A árvore contém Gerbers, BOM/CPL e arquivo EAGLE, sem implementação do firmware para auditar isolamento de leitura ou drivers de acesso.
- Licenciamento NC e termos incompletos impedem tratar os materiais como livremente incorporáveis ao aplicativo de uma oficina comercial sem esclarecimento/autorização específica.
- Não há submódulos Git identificados. Firmware, mapa e arquivos de fabricação não foram baixados, executados, gravados ou validados em bancada.

**Decisão:** Excluir firmware, mapas, INIs, esquemas e arte de qualquer pacote/runtime desta entrega. Registrar somente referência e limites da auditoria. Não criar adaptador SCG nem prometer suporte aos veículos do AUTO ECU LAB. Eventual uso de materiais exige esclarecer versão/escopo da licença, direitos de componentes de terceiros, autorização para uso pretendido e protocolo de leitura validado.

**Fontes na revisão auditada**

- [Árvore da revisão](https://github.com/dvjcodec/SCG-ECU-2.0-STM32F407-8x8/tree/1e25e7249d20044b5d39f70b28919943a0a5ae84)
- [LICENSE.md](https://github.com/dvjcodec/SCG-ECU-2.0-STM32F407-8x8/blob/1e25e7249d20044b5d39f70b28919943a0a5ae84/LICENSE.md)
- [README.md](https://github.com/dvjcodec/SCG-ECU-2.0-STM32F407-8x8/blob/1e25e7249d20044b5d39f70b28919943a0a5ae84/README.md)

## Consequências para o AUTO ECU LAB

- **Diagnóstico e sensores:** conservar o conector ELM327 de leitura com lista de serviços/PIDs permitidos, descoberta dos sinais suportados, ECU de origem e falhas/ausências explícitas. Protocolos TunerStudio/INI de ECU aftermarket não se tornam OBD-II pelo uso da mesma porta USB.
- **Identificação:** número de peça, firmware e família de uma ECU precisam de resposta/documentação da origem. Uma assinatura anunciada ou um modelo de veículo não confirma cobertura. O conflito de assinatura Slowduino demonstra por que cada versão precisa ser validada.
- **USB, Bluetooth e Wi-Fi:** transporte é separado do protocolo. APIs de navegador, UUIDs BLE, porta serial/Classic e endpoint TCP Python precisam de documentação real do adaptador; não haverá DLL, bridge ou integração proprietária presumida.
- **BIN e 2D/3D:** trabalhar sobre bytes do arquivo local fornecido pelo operador, com região/tipo/endian explícitos e sem edição. Os arquivos de referência desses projetos não serão distribuídos nem usados como tabelas OEM ou estatísticas reais.
- **Análise do acelerador e relatórios:** continuar a medir atraso apenas em aquisições documentadas. BIN, mapas-base, simuladores, valores de páginas stub e catálogos não representam medições reais de pedal/borboleta/RPM.
- **Expansão:** projetos GPL podem permitir reutilização sob suas condições, mas não são automaticamente compatíveis com qualquer distribuição. Não há incorporação nesta entrega; uma proposta futura deve revisar o componente, suas dependências, fonte correspondente, avisos e a licença da aplicação. A contradição MIT/GPL e a declaração NC incompleta precisam ser resolvidas antes de qualquer uso material.

