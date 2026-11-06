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
