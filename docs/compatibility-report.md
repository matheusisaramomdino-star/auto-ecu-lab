# AUTO ECU LAB 2.3 — módulos e relatório de compatibilidade

Auto Elétrica Doidinho · revisão técnica de 6 de novembro de 2026. A entrega mantém o site, a identidade da PWA, o armazenamento existente e o ícone instalado. Nenhum código, executável, firmware, dump, mapa, definição INI/XDF ou ativo de marca dos seis projetos auditados foi incorporado. Os módulos novos são implementações próprias. Repositórios de software não fornecem, por si só, medições reais de veículos.

## Funções entregues

| Módulo | Implementação e limite | Verificação |
| --- | --- | --- |
| Diagnóstico OBD-II | `obd.mjs` valida comandos ELM327 documentados e serviços de leitura; não oferece console arbitrário. `connections.mjs` só abre hardware após ação do operador. | Respostas de protocolo e transportes substitutos; nenhuma validação física nesta entrega. |
| Identificação da ECU | VIN, CALID/CVN quando suportados e origem CAN recebida; identificação transcrita no cadastro. Não infere fabricante ou família pelo veículo. | Testes de origem, mensagens incompletas e múltiplas ECUs. |
| Sensores | Consulta separada de carga, temperaturas, MAP, velocidade, MAF e tensão do módulo, conforme PIDs anunciados. Preserva unidade, origem e horários. Não muda a aquisição do pedal nem fornece zeros para canais ausentes. | Vetores de decodificação, whitelist, indisponibilidade e consulta explícita. |
| Arquivos BIN | `binary.mjs` inspeciona até 8 MiB de bytes locais: SHA-256, prévia hexadecimal, distribuição/entropia e recorte explícito de tabela. Tipos, offset, dimensões e ordem de bytes são fornecidos pelo operador. | Vetores de bytes, limites, endian, números não finitos e imutabilidade. |
| Visualização 2D/3D | `binary-workbench.mjs` desenha linha e superfície dos valores efetivamente lidos do recorte. Eixos são índices e valores brutos, sem unidades físicas presumidas. Exporta relatório JSON, sem gerar BIN alterado. | DOM em memória e geometria derivada de vetores conhecidos. |
| Resposta do acelerador | Mantém análise de pedal, borboleta e RPM, resolução temporal, lacunas, respostas ausentes e simulação matemática separada. | Suítes existentes de análise, simulação e proveniência. |
| Relatórios e base | HTML/JSON/CSV dos ensaios e Markdown desta auditoria. Estatísticas somente de medições documentadas, por grupos comparáveis, sem simulações, duplicatas ou números inventados. | Importação, relatórios, migração, deduplicação e coortes. |
| Atualizações | Versão 2.3/cache v5 no mesmo endereço e ícone. Leitura BIN, arquivo ainda não exportado, coleta, consulta, salvamento e formulário pendente adiam a aplicação da atualização. | Testes do service worker, barreiras de atualização e persistência. |

## Conectividade e scanners

| Plataforma/caminho | Disponibilidade real no projeto |
| --- | --- |
| Windows / navegador | BLE GATT ou Web Serial somente quando as APIs existem, o adaptador documenta seus parâmetros e o usuário concede acesso. |
| Android / navegador | BLE ou Serial dependem de navegador, versão, permissões e adaptador. USB OTG não implica suporte automático. |
| iOS / PWA | Arquivos, BIN, gráficos, simulações e relatórios. Sem promessa de acesso BLE/Serial/USB direto no Safari; acesso ao scanner exige implementação nativa autorizada compatível. |
| Python / USB e Classic | Transporte serial existente, com porta/driver apropriados. Classic e BLE são caminhos distintos. |
| Python / Wi-Fi e BLE | TCP host/porta ou UUIDs GATT documentados. O site não abre TCP bruto e não instala uma ponte automaticamente. |
| J2534, Rasther III/S direto e outros SDKs | Não oferecidos como conectores operacionais. Dependem de licença, API/driver autorizados, arquitetura e testes. Rasther conserva o adaptador de importação CSV, cujo layout real precisa ser validado. |

O catálogo Hilux, SW4, Strada 2022 1.4, S10, Ranger, L200 e Amarok serve ao cadastro, sem certificar cobertura. Suporte depende da ECU, protocolo e PIDs reais. Não houve ensaio com scanner ou veículo. Nenhuma função de escrita real, limpeza de DTC, desbloqueio, atuação ou alteração de segurança/emissões foi acrescentada.

## Decisão de arquitetura e expansões

Somente ferramentas executáveis desta entrega aparecem como operações. Projetos de firmware e editores desktop permanecem referências documentais. Implementações de scanner futuras devem fornecer contrato versionado de protocolo e transporte, origem de cada canal, comportamento de erro/timeout, documentação de autorização/licença, teste em bancada e uma interface isolada exclusivamente de leitura. Recursos de escrita não podem ser expostos por um adaptador de leitura.

Definições de mapas BIN, XDF/INI e identificação automática ficam fora desta entrega: exigem formato documentado, licença de cada definição, procedência dos arquivos e testes que comprovem a interpretação. Um gráfico de bytes não demonstra uma calibração válida. A inspeção genérica não valida checksum específico de fabricante nem permite inferir ECU a partir de strings.

## Licenças e dependências

A auditoria abaixo verifica evidências dos seis repositórios nas revisões citadas, sem afirmar validade jurídica universal ou auditoria completa de dependências transitivas. O aplicativo mantém a política de licenciamento de seu próprio repositório; não foi escolhida uma nova licença em nome do titular.

O runtime web continua sem bibliotecas externas. `linkedom` (ISC) e `fake-indexeddb` (Apache-2.0) são dependências de desenvolvimento registradas no lockfile, usadas em testes. O Python preserva Flask e integrações opcionais já declaradas em `python/pyproject.toml`; não foram vendorizados frameworks, SDKs ou drivers dos projetos auditados. Uma futura redistribuição de dependências/SDKs deve preservar seus próprios avisos e obrigações.

## Reprodução e limites da validação

```bash
npm ci
npm test
npm run check
python scripts/build-compatibility-report.py
cd python
python -m pip install -e ".[dev]"
python -m pytest -q
```

`docs/repository-audit.json` registra revisões e fontes; `scripts/build-compatibility-report.py` gera este documento completo e o módulo disponível offline. As fixtures sintéticas ficam exclusivamente nos testes, sem alimentar a base operacional. Não foram executados os programas de terceiros. A validação visual desta entrega cobre estrutura DOM e CSS; não houve sessão de navegador real no ambiente disponível. O desenho independente usa as referências oficiais registradas em `docs/design-reference-v23.md`.


---

# Auditoria de referências — grupo A

Inspeção em **6 de novembro de 2026**, com revisões fixadas abaixo. Metadados, árvore Git, README, licenças, manifests e arquivos de implementação foram lidos pelas ferramentas GitHub. Não foram executados programas, instaladas dependências, baixados dumps nem testados veículos. Esta é uma avaliação técnica de evidências públicas e condições declaradas de reutilização, não uma certificação de cobertura, segurança ou validade jurídica de todos os componentes.

| Repositório | Revisão | Licença identificada | Decisão para esta entrega |
| --- | --- | --- | --- |
| serpentine | `88ac390e3ed63b6444f8f1d6408bbffbc459d5ac` | Sem concessão explícita identificada | Referência conceitual; sem incorporar código/dumps |
| blackflag-ecu | `ac68bf5e2fcb4700d9b0baf4d6a009c923aaed46` | MIT nos materiais publicados | Sem integrar binário; capacidades não verificáveis no fonte disponível |
| ZedSuite | `77d75fb9e28df04379fd6d1912197947f1cce0c0` | GPL-3.0-only; marcas excluídas | Referência de organização/UX; implementação independente |

## 1. flexadecimal/serpentine

**Plataforma observada:** Python 3.10; lark/lxml/numpy/toml/Pint/pynverse; núcleo XDF e notebook. README de início ainda usa todo.py.

**Licença e limites de reutilização**

- Árvore recursiva sem LICENSE, COPYING ou NOTICE; metadados GitHub license:null.
- README descreve ecushark/browser/XDF/ADX, mas não contém concessão de licença.
- Cabeçalhos dos arquivos Python inspecionados não identificam uma licença.

**Compatibilidade e evidências funcionais**

- README lista edição XDF como funcionalidade; xdf_parse.py diz TODO para interpretar ADX.
- Xdf.from_path abre o BIN em r+b; testes de exemplo aplicam patches/escritas. Não satisfaz isolamento de leitura sem adaptação.
- Há arquivos BIN/XDF/ADX de veículos e origem mencionada M44/OpenEEC, sem licenças individuais verificadas; não são dados de scanner nem cobertura da frota AUTO ECU LAB.
- Dependências usam '*' no Pipfile; não foi encontrado Pipfile.lock na árvore. Nenhum transporte USB/BLE/TCP ou scanner operacional demonstrado nos arquivos examinados.
- Não há submódulo Git na árvore inspecionada.

**Decisão:** Não incorporar código, schemas ou dumps. Usar somente como referência conceitual de separação entre definição e bytes; implementar inspeção BIN original, local, imutável, com endianness/tipo/offset explícitos. Futuro XDF depende de formato documentado, licença/autorizações e corpus de teste.

**Fontes na revisão auditada**

- [Árvore da revisão](https://github.com/flexadecimal/serpentine/tree/88ac390e3ed63b6444f8f1d6408bbffbc459d5ac)
- [README.md](https://github.com/flexadecimal/serpentine/blob/88ac390e3ed63b6444f8f1d6408bbffbc459d5ac/README.md)
- [Pipfile](https://github.com/flexadecimal/serpentine/blob/88ac390e3ed63b6444f8f1d6408bbffbc459d5ac/Pipfile)
- [core/entity/Xdf.py](https://github.com/flexadecimal/serpentine/blob/88ac390e3ed63b6444f8f1d6408bbffbc459d5ac/core/entity/Xdf.py)
- [xdf_parse.py](https://github.com/flexadecimal/serpentine/blob/88ac390e3ed63b6444f8f1d6408bbffbc459d5ac/xdf_parse.py)

## 2. bad-antics/blackflag-ecu

**Plataforma observada:** README: Windows10/11 x64, C#/WPF/.NET8, J2534. A árvore auditada não contém fonte .cs, .sln ou .csproj; EXE é ponteiro Git LFS.

**Licença e limites de reutilização**

- LICENSE contém texto MIT e README declara MIT; não foi identificado conflito entre esses dois avisos.
- A concessão MIT dos materiais do repositório não demonstra quais dependências/licenças estão dentro do executável LFS nem autoriza automaticamente DLLs de fabricantes.

**Compatibilidade e evidências funcionais**

- BlackFlag.exe versionado é um ponteiro de134bytes para objeto LFS de163118325bytes; o executável não foi baixado/executado.
- Não há fonte auditável da implementação anunciada de OBD-II, identificação, sensores, J2534, CAN, K-Line, J1850 ou gravação.
- FAQ afirma suporte Linux nativo/SocketCAN e macOS; README se apresenta como Windows nativo. Inconsistência impede prometer compatibilidade.
- CONTRIBUTING pede abrir BlackFlag.sln, inexistente na árvore inspecionada.
- README anuncia desbloqueio de ECU, flash, alteração de limites e limpeza de DTC: funcionalidades fora do escopo do AUTO ECU LAB.
- JSONs de veículos são catálogos; não comprovam cobertura de ECUs, medições reais ou estatísticas.
- O diagrama J2534 é documentação descritiva, não um SDK/driver validado. Nenhum submódulo Git identificado.

**Decisão:** Não integrar o executável nem declarar suporte com base em tabelas/promessas. Manter OBD-II próprio de leitura com ELM327 documentado; J2534 somente após driver/API autorizados, arquitetura comprovada e testes. Nenhuma rotina de desbloqueio, flash, limpeza DTC ou alteração de limites será implementada.

**Fontes na revisão auditada**

- [Árvore da revisão](https://github.com/bad-antics/blackflag-ecu/tree/ac68bf5e2fcb4700d9b0baf4d6a009c923aaed46)
- [LICENSE](https://github.com/bad-antics/blackflag-ecu/blob/ac68bf5e2fcb4700d9b0baf4d6a009c923aaed46/LICENSE)
- [README.md](https://github.com/bad-antics/blackflag-ecu/blob/ac68bf5e2fcb4700d9b0baf4d6a009c923aaed46/README.md)
- [BlackFlag.exe](https://github.com/bad-antics/blackflag-ecu/blob/ac68bf5e2fcb4700d9b0baf4d6a009c923aaed46/BlackFlag.exe)
- [docs/FAQ.md](https://github.com/bad-antics/blackflag-ecu/blob/ac68bf5e2fcb4700d9b0baf4d6a009c923aaed46/docs/FAQ.md)
- [CONTRIBUTING.md](https://github.com/bad-antics/blackflag-ecu/blob/ac68bf5e2fcb4700d9b0baf4d6a009c923aaed46/CONTRIBUTING.md)
- [docs/diagrams/J2534_INTERFACE.md](https://github.com/bad-antics/blackflag-ecu/blob/ac68bf5e2fcb4700d9b0baf4d6a009c923aaed46/docs/diagrams/J2534_INTERFACE.md)

## 3. LeZed97/ZedSuite

**Plataforma observada:** Aplicativo desktop Windows/macOS/Linux; frontend Next15/React18/TypeScript exportado estaticamente; motor Rust e APIs de arquivo via Tauri2/IPC. Gráficos incluem Plotly/Three.js.

**Licença e limites de reutilização**

- LICENSE é GPLv3; package.json e src-tauri/Cargo.toml especificam GPL-3.0-only, eliminando ambiguidade do badge GPL-3.0.
- NOTICE/TRADEMARKS reservam nome, logotipo, mascote e ícones ZedPerf/ZedSuite; forks precisam de identidade própria.
- Não foi realizada auditoria integral das licenças transitivas npm/Cargo; manifests/locks não substituem SBOM e avisos de cada dependência.

**Compatibilidade e evidências funcionais**

- README limita detecção automática aos Bosch VAG EDC15P, EDC15VM+, EDC16U1/U31/U34. Abrir qualquer BIN não significa identificar qualquer ECU.
- Importação .ols/.xdf/JSON declarada beta e depende de definições; não implica cobertura Strada1.4/Hilux/S10/Ranger/L200/Amarok.
- Há código de identificação/detecção de arquivos, hex, tabelas e vistas2D/3D; são referências verificáveis de organização, não conector de scanner.
- Comandos Rust expostos por Tauri leem/escrevem arquivos; uma PWA estática não executa esses comandos IPC nativos sem uma implementação própria.
- README anuncia edição BIN, DTC on/off e correção checksum; essas operações ficam fora desta entrega de leitura.
- next.config.js desativa erro TypeScript e lint no build; existência de build não equivale a verificação de correção.
- Não há submódulo Git identificado. Não foram baixados dumps nem reproduzidas alegações de validação em bancada.

**Decisão:** Estudar somente padrões públicos de UX e separação de módulos. Não copiar código GPL/assinaturas/calibrações nem ativos visuais nesta entrega. Implementar leitor BIN original e visualizações2D/3D sem edição, identificação automática presumida ou escrita. Reuso futuro de código exigiria análise de obra derivada, licenciamento compatível GPL, fonte correspondente/avisos e preservação de marcas separadas.

**Fontes na revisão auditada**

- [LICENSE](https://github.com/LeZed97/ZedSuite/blob/77d75fb9e28df04379fd6d1912197947f1cce0c0/LICENSE)
- [NOTICE](https://github.com/LeZed97/ZedSuite/blob/77d75fb9e28df04379fd6d1912197947f1cce0c0/NOTICE)
- [TRADEMARKS.md](https://github.com/LeZed97/ZedSuite/blob/77d75fb9e28df04379fd6d1912197947f1cce0c0/TRADEMARKS.md)
- [README.md](https://github.com/LeZed97/ZedSuite/blob/77d75fb9e28df04379fd6d1912197947f1cce0c0/README.md)
- [package.json](https://github.com/LeZed97/ZedSuite/blob/77d75fb9e28df04379fd6d1912197947f1cce0c0/package.json)
- [src-tauri/Cargo.toml](https://github.com/LeZed97/ZedSuite/blob/77d75fb9e28df04379fd6d1912197947f1cce0c0/src-tauri/Cargo.toml)
- [src-tauri/src/commands.rs](https://github.com/LeZed97/ZedSuite/blob/77d75fb9e28df04379fd6d1912197947f1cce0c0/src-tauri/src/commands.rs)
- [next.config.js](https://github.com/LeZed97/ZedSuite/blob/77d75fb9e28df04379fd6d1912197947f1cce0c0/next.config.js)

## Consequências para os módulos AUTO ECU LAB

- **OBD-II, identificação e sensores:** nenhum dos três repositórios demonstra um adaptador pronto para acoplar à PWA atual. Continuar o protocolo ELM327 próprio de leitura; suporte depende de PID anunciado pelo veículo, origem ECU explícita e documentação do adaptador. Ausência de sinal permanece indisponível. J2534 e Rasther direto não recebem botão operacional sem integração documentada e validada.
- **BIN:** aceitar arquivo local fornecido pelo operador e documentar tamanho/hash, offset, tipo, endianness e dimensões. Visualizar bytes não confirma família ECU, unidade física, checksum de calibração ou endereço de mapa. Não distribuir dumps, XDFs/ADXs ou definições retirados desses repositórios.
- **2D/3D:** renderizar valores efetivamente lidos da região selecionada e rótulos definidos pelo operador, preservando o original. Um gráfico visual não comprova mapa funcional nem calibração segura. Nenhuma exportação de BIN modificado.
- **Resposta do acelerador e relatórios:** manter análise de medições reais e simulação matemática separadas; não importar catálogos de veículos, alegações comerciais ou arquivos BIN como estatísticas de atraso.
- **Identidade e expansões:** preservar Auto Elétrica Doidinho e seus ativos. Padrões genéricos de navegação e tabelas podem orientar uma implementação original; isso não autoriza copiar marca, telas, ícones ou componentes sem observar suas licenças. Antes de um futuro reuso, revisar o código específico, dependências, avisos, vínculo com a aplicação e obrigações de distribuição.


---

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


