# AUTO ECU LAB — Auto Elétrica Doidinho

Continuação do repositório existente: aplicação web instalável para **Windows, Android e iOS**, com preto `#141414`, cinza `#242424`, laranja `#FF8A00` e branco `#FFFFFF`. A versão Python está preservada em [`python/`](python/), com módulos de diagnóstico opcionais.

Site: [abrir AUTO ECU LAB](https://auto-ecu-lab-mobile.matheusisaramomdino.chatgpt.site). Os arquivos e diagnósticos permanecem locais, sem upload para um servidor de análise.

## Versão 2.3

A revisão inclui **Arquivos BIN** com inspeção local e tabelas 2D/3D, consulta pontual de sete sensores OBD-II documentados e uma interface de oficina mais compacta. A área **Compatibilidade** apresenta a auditoria dos seis repositórios solicitados, fontes e condições de conexão. O site continua no mesmo endereço e ícone; dados e preferências existentes são preservados.

- [Relatório completo de licenças e compatibilidade](docs/compatibility-report.md)
- [Módulos, conexões e limites da entrega](docs/module-plan-v23.md)
- [Sensores documentados](docs/obd-sensors.md)
- [Referência visual e decisões de design](docs/design-reference-v23.md)

Não há integração direta com executáveis/firmware dos projetos auditados, edição de BIN, correção de checksum ou escrita real na ECU. Arquivos BIN ficam em memória neste aparelho, até exportar o relatório ou fechar o arquivo; a inspeção não fornece identificação automática de ECU ou mapas. J2534, Rasther direto e outros SDKs permanecem somente na documentação de requisitos.

## Recursos

- Base inicial vazia, sem medições nem estatísticas fictícias. **Base real e estatísticas** calcula resultados locais apenas para registros com origem documentada; arquivos sem evidência suficiente continuam disponíveis para análise individual.
- Cadastro de veículo/ECU, CSV de parâmetros e relatórios DTC, análise de pedal/borboleta/RPM, gráficos, atraso por evento, simulação matemática e relatórios HTML/JSON/CSV.
- Catálogo de **Hilux, SW4, Strada 2022 1.4, S10, Ranger, L200 e Amarok**. Informe ano/motor quando não especificados; o modelo não confirma ECU ou cobertura do scanner.
- Área **Conexões e scanners** com operação real **somente leitura** para ELM327 documentado: descoberta de PIDs, sinais disponíveis, VIN/CALID/CVN e DTCs armazenados/pendentes/permanentes.
- No navegador: BLE GATT e Web Serial, quando APIs/adaptador forem compatíveis. BLE exige UUIDs do fabricante; USB/Classic precisam de porta serial compatível. Não existe console arbitrário.
- No Python: ELM327 por serial USB/Classic, Wi-Fi TCP ou BLE nativo, com dependências opcionais. CAN11/29 bits no Python; o perfil web inicial valida CAN de 11 bits.
- Backup JSON validado, IndexedDB com proteção contra sobrescrita de abas e cache offline com atualização quando não há operação ou alteração pendente.

O repositório conectado [matheusisaramomdino-star/auto-ecu-lab](https://github.com/matheusisaramomdino-star/auto-ecu-lab), revisão `3cd65267552d35051754381fa0df576ea2cb8095`, contém um README de objetivos, sem arquivos de aquisição. Nenhuma medição ou estatística foi importada dele. Código, catálogo de veículos e tabelas de PIDs não constituem uma base de medições reais. Veja os critérios e a rastreabilidade em [docs/REAL_DATA.md](docs/REAL_DATA.md).

## Limites de integração

**J2534** depende de driver/DLL, arquitetura e implementação autorizada; o registro está preparado, mas não é um conector operacional. **Rasther III/S** conserva o CSV adaptável; conexão direta exige SDK/API autorizado. **Outros scanners** exigem SDK/licença. Não houve dedução de protocolos proprietários.

| Plataforma | Análise, simulação e relatórios | Conexão direta |
| --- | --- | --- |
| Windows | PWA ou Python | BLE/Web Serial no navegador compatível; serial/Wi-Fi/BLE pelo Python |
| Android | PWA | BLE quando disponível; Classic/USB dependem de API serial, versão e adaptador |
| iOS/iPadOS | PWA | Sem promessa de BLE/Serial/USB direto no Safari; exige aplicativo/SDK nativo compatível |

A presença real de `navigator.bluetooth` ou `navigator.serial`, as permissões e o manual do adaptador determinam as opções. O site HTTPS não abre TCP bruto nem instala uma ponte local automaticamente. Veja [`docs/compatibility.md`](docs/compatibility.md) e [`docs/integrations.md`](docs/integrations.md).

## Instalar

- **iPhone/iPad:** Safari → Compartilhar → **Adicionar à Tela de Início** → Adicionar. Saia de navegadores internos de outros apps antes de instalar.
- **Android:** Chrome → **Instalar app**, quando oferecido, ou ⋮ → **Instalar aplicativo / Adicionar à tela inicial**.
- **Windows:** use a instalação de aplicativo do navegador compatível, ou execute o Python.

Instalar a PWA não instala drivers/SDKs. Conectado à internet, aguarde **Pronto para usar offline** antes de desconectar. Na primeira migração, use **Atualizar agora** ou feche e reabra o mesmo ícone, com as operações encerradas. A versão 2.3 mantém a verificação e aplicação automática quando o aplicativo está livre, sem outra instalação. Identidade, endereço inicial e escopo da PWA permanecem os mesmos.

## Operação real e simulação

Os modos são separados: `simulation` identifica exemplos legados, `imported` identifica arquivos e `real` identifica aquisição real explícita. Exemplos legados comprovados são arquivados localmente antes de sair da base ativa; dados sem evidência de simulação são preservados. Dados fictícios não podem ser reclassificados como medições reais. O simulador usa os sinais carregados e nunca envia curvas ou calibrações ao veículo.

Para estatísticas, um rótulo `real` ou uma confirmação isolada não basta: são exigidos sinais válidos e metadados de origem. Coortes separam veículo/ECU, hardware/software, definição dos sinais e parâmetros de análise. Duplicatas não aumentam contagens; ausência de resposta não vira atraso zero. Os resultados descrevem os registros locais, sem estimar incidência de falhas da frota nem limites de fábrica.

A conexão real começa apenas depois da escolha do usuário e da permissão do navegador. Várias ECUs exigem origem explícita. PID ausente fica indisponível/`null`, nunca zero. A análise exige os três sinais completos; dados parciais são exportáveis em JSON com erros e timestamps de canal. Aquisição sequencial é parte da incerteza temporal.

Não há gravação na ECU, limpeza de DTCs, programação, desbloqueio, testes de atuadores ou alteração de segurança/emissões. OBD-II genérico não certifica diagnóstico de ABS, airbag ou módulos proprietários.

## Windows / Python

```bash
cd python
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
python -m pip install -e ".[dev]"
python -m auto_ecu_lab
```

Dependências opcionais: `python -m pip install -e ".[hardware]"`. A listagem abaixo não abre hardware:

```bash
python -m auto_ecu_lab.diagnostics integrations
```

Aquisição real exige o subcomando `read` e porta/host/UUIDs documentados. Exemplos e limites em [`python/docs/diagnostics.md`](python/docs/diagnostics.md). Substitua os parâmetros de exemplo pelos publicados para seu adaptador.

## Dados e backup

Dados ficam no aparelho/perfil de navegador, sem sincronização automática. Exporte backup antes de trocar de aparelho, limpar dados ou reinstalar. Algumas versões do iOS isolam o armazenamento da PWA e do Safari. Se baixar abrir uma prévia no iPhone, use **Compartilhar → Salvar em Arquivos**; gerar o arquivo não confirma que ele já foi salvo fora do navegador.

Restaurar um backup exige validação completa e confirmação de substituição. O JSON real mantém registros parciais; o relatório HTML de análise funciona offline e pode ser impresso como PDF.

A migração da PWA conserva os registros de demonstração antigos no banco local independente `auto-ecu-lab-legacy-archive` antes de atualizar a base ativa. Os registros reais ou não verificados permanecem ativos. O backup usual da base ativa não inclui esse arquivo legado; limpar os dados do site também pode apagá-lo. Guarde seus backups anteriores e os arquivos originais do scanner. O procedimento e os limites estão em [docs/REAL_DATA.md](docs/REAL_DATA.md).

## Desenvolvimento e testes

```bash
npm ci
npm test
npm run check
cd python
python -m pip install -e ".[dev]"
python -m pytest -q
```

Os testes usam respostas fictícias, transportes substitutos, IndexedDB e DOM em memória. As fixtures sintéticas ficam em `tests/fixtures/` e `python/tests/fixtures/`, isoladas do código executado pelo aplicativo. O pacote-fonte Python inclui testes identificados como sintéticos, sem carregá-los na base operacional. Não fazem pareamento nem conectam scanners/veículos. Não houve validação física. Os testes DOM não são apresentados como testes Safari/Chrome.

Para regenerar o relatório disponível offline: `python scripts/build-compatibility-report.py`.

Para regenerar o pacote-fonte Python servido pelo site: `python scripts/package-python.py`. O empacotamento exclui bancos, caches, ambientes virtuais e arquivos `.env`.

A PWA não tem dependências externas em tempo de execução. `linkedom` e `fake-indexeddb` são dependências de desenvolvimento. Fonte em `dist/`, testes em `tests/` e Python completo em `python/`. A hospedagem conserva o `project_id`, o endereço e o acesso público existentes. Veja [`docs/development-v2.md`](docs/development-v2.md).

## Mesmo aplicativo, novas melhorias

A área **Sistema e atualizações** mostra a versão atual/publicada, a verificação manual, a política automática e atalhos personalizáveis. O app não exige outro ícone. Coletas, conexões, salvamentos, arquivos e rascunhos pendentes adiam a aplicação; todas as abas precisam confirmar. Os dados IndexedDB existentes são preservados. Sem conexão, permanece a versão preparada.

Preferências de atalhos/atualização e parâmetros comparados do simulador ficam em um banco separado do workspace. O backup de diagnóstico continua no formato anterior. SDKs/drivers nativos são atualizados separadamente. Detalhes da primeira migração, da arquitetura e dos limites estão em [docs/updates-without-reinstall.md](docs/updates-without-reinstall.md). O [estudo de recursos públicos](docs/public-product-study.md) registra as referências e as decisões independentes.
