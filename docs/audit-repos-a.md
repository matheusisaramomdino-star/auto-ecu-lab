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
