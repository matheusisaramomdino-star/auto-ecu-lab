# AUTO ECU LAB — Auto Elétrica Doidinho

Aplicação Python local, com interface em português, para analisar medições de diagnóstico automotivo. A base inicia **vazia**, sem veículo, ECU, ensaio ou estatística pré-carregados. O cadastro oferece Hilux, SW4, Strada 2022 1.4, S10, Ranger, L200 e Amarok como opções; essas referências não confirmam ECU ou cobertura do scanner.

## Executar

Requer Python 3.11 ou superior. Na pasta do projeto:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
python -m auto_ecu_lab
```

No Windows, ative com `.venv\Scripts\activate` no Prompt ou `.venv\Scripts\Activate.ps1` no PowerShell. Abra **http://127.0.0.1:8000**. Alternativa: `auto-ecu-lab --port 8001`. Após instalar as dependências, gráficos, relatórios e análises funcionam sem internet.

O servidor usa `127.0.0.1`, sem depuração. É uma ferramenta local de um usuário, sem autenticação para hospedagem pública. Os dados ficam em `instance/auto_ecu_lab.sqlite3`, relativos à pasta de execução. Para backup, pare a aplicação e copie essa pasta. `AUTO_ECU_DATABASE` permite escolher outro caminho; `AUTO_ECU_SECRET` mantém a chave de sessão entre reinícios.

## Fluxo de uso

1. Em **Veículos e ECU**, cadastre o veículo. Transcreva identificação, fabricante, HW e SW efetivamente mostrados pelo scanner; deixe desconhecidos em branco.
2. Em **Importar dados**, selecione o CSV, informe origem/scanner, data e fuso da aquisição e confirme que são medições reais. Data de importação e data da captura são diferentes. O aplicativo calcula o SHA-256 do arquivo recebido. Um CSV de DTCs pode acompanhar o ensaio. Todos os arquivos são validados antes de salvar.
3. Em **Análise de resposta**, explore pedal, borboleta e RPM, os eventos e os critérios configurados. Resultados indicam hipóteses exploratórias, sem comprovar defeito.
4. Em **Estatísticas reais**, consulte coortes comparáveis, contagens e fontes documentadas. Registros antigos sem proveniência continuam disponíveis individualmente, mas não entram nas estatísticas.
5. Em **Simulador**, compare modelos matemáticos e baixe curvas derivadas em CSV. A simulação não substitui a medição nem entra na base estatística.
6. Em **Relatórios**, baixe HTML independente, JSON estruturado ou CSV normalizado. Para PDF, abra o HTML e use **Imprimir → Salvar como PDF**.

Não há gerador, botão, download ou rota de demonstração no aplicativo. `SEED_DEMO` não produz efeito, mesmo em configurações antigas.

## CSV de parâmetros

Cabeçalho aceito:

```csv
tempo_s;pedal_pct;throttle_pct;rpm
```

Adicione somente linhas de medições reais. O aplicativo não fornece valores para completar dados ausentes.

- UTF-8 (com ou sem BOM) ou Windows-1252; separador `;`, `,` ou tabulação. Vírgula decimal exige outro separador ou células entre aspas.
- Quatro colunas obrigatórias: tempo, pedal em %, borboleta em % e rotação em RPM. Sem símbolos de unidade ou separadores de milhar nas células.
- Tempo em segundos, milissegundos (`tempo_ms`/`time_ms`) ou `HH:MM:SS.sss`. Para outros nomes, escolha a unidade explicitamente quando necessário.
- Tempo estritamente crescente, sem duplicatas. O importador não ordena, descarta ou preenche linhas. Horários atravessando meia-noite devem ser convertidos em tempo decorrido crescente.
- Pedal/borboleta entre 0 e 100%; RPM entre 0 e 15000 (limite do importador, sem significado de limite operacional). Ângulo, tensão e valor bruto exigem conversão documentada.
- Até 5 MB e 50.000 linhas; pelo menos duas amostras.
- Cabeçalhos em português e mapeamento manual são aceitos; cabeçalhos ambíguos exigem seleção explícita.

DTCs opcionais usam `codigo;descricao;status`. Códigos e estados são transcritos pelo operador; o aplicativo não apaga DTCs. Veículo e ECU são preservados como estavam no momento da importação.

**Rasther III/S:** adaptador de tabelas CSV documentado, sem SDK ou protocolo proprietário. Nenhuma medição real desse scanner foi fornecida com o projeto. Compatibilidade com um layout oficial depende de arquivo/documentação autorizados. Não existe acesso direto Rasther implícito pelo cadastro.

## Proveniência e estatísticas

`metadata.provenance` tem este contrato:

| Campo | Exigência |
| --- | --- |
| `schema_version` | Inteiro `1` |
| `kind` | `scanner_report`, `scanner_capture` ou `repository_dataset` |
| `source`, `reference` | Origem e referência não vazias |
| `captured_at` | Data ISO 8601 da aquisição com fuso |
| `sha256` | 64 caracteres hexadecimais |
| `verification` | `operator_confirmed`, `protocol_capture` ou `documented_dataset`, de acordo com `kind` |
| Repositório | `repository_url` HTTPS, `revision` e `license` documentados |

CSV importado usa `scanner_report`, confirmação manual e hash do arquivo original. Captura CLI usa `scanner_capture`, identificador `metadata.capture_id`, início real em `metadata.connection.started_at`/`started_at_utc` e origem ECU recebida em `metadata.identity.ecuId`/`connection.ecuId`. O hash da captura corresponde aos bytes exatos do CSV complementar. Um hash e uma declaração de operador permitem rastreabilidade; não comprovam validação em hardware.

`real_statistics()` em `statistics.py` usa somente registros que atendem ao contrato e possuem os quatro sinais válidos. Exclui demonstrações, simulações, arquivos sem comprovação documental e duplicatas por hash ou amostras idênticas. As impressões SHA-256 dos exemplos antigos e do DTC de demonstração são bloqueadas na importação e nas estatísticas, mesmo quando alguém os marca como reais; renomear o arquivo não muda seu hash. Uma edição do conteúdo muda o hash, portanto esse bloqueio não substitui a declaração responsável de origem. Não baixa datasets nem transforma um repositório de software em medições. Salvamentos do mesmo `capture_id` contam uma vez quando as versões são prefixos consistentes: prevalece a mais completa. Sobreposições, origens ECU, datas ou definições divergentes excluem todas as versões daquele identificador, com motivo `captura_conflitante`.

Cada coorte separa marca/modelo/ano/motor, ECU/HW/SW, fonte, definições dos canais, intervalo mediano e parâmetros de análise. ECU/HW/SW incompletos restringem o grupo ao veículo cadastrado. Definições dos canais incompletas restringem o grupo ao ensaio. Para canais OBD-II realmente utilizados, a CLI declara `monotonic_seconds`, `OBD-II 01 49 percent`, `OBD-II 01 11 percent` e `OBD-II 01 0C rpm`; outro PID ou definição permanece em outra coorte.

A página `/estatisticas` e o endpoint somente leitura `/api/estatisticas` retornam contagens reais. O JSON contém `schema_version`, `scope`, `counts` (`active`, `eligible`, `excluded`, `duplicates`, `cohorts`, `archived_demo`), `exclusions`, `cohorts` e `limitations`. Cada coorte expõe fontes, período, número de ensaios/amostras/eventos, intervalos dos sinais e resumos de atraso (`count`, `minimum`, `median`, `maximum`, `p95`). O P95 usa o valor observado na posição `ceil(0,95 × n)`, sem interpolação. Contagens de resposta ausente e eventos com lacunas acompanham cada grupo. Sem resposta observável, valores são `null` e contagem de respostas é zero. Não existe mediana global misturando veículos, percentual de falhas ou referência de fábrica inventada.

## Bancos antigos: migração v1 → v2

A migração SQLite é atômica. Ensaios `is_demo = 1` recebem uma cópia JSON integral em `demo_archive`, incluindo o cadastro do veículo, antes de sair da lista ativa. Os registros originais continuam em `recordings`, com `archived = 1`; nenhuma linha real `is_demo = 0` é apagada ou reclassificada. O cadastro exato da antiga Strada de demonstração sai da lista somente quando não tem nenhum ensaio real associado e sua ECU continua vazia/não confirmada. Cadastros que receberam identificação, HW, SW ou campos adicionais de ECU são preservados. Os outros cadastros permanecem.

A tabela `demo_archive` e `Repository.archive_backups()` permitem recuperar os dados antigos localmente e revisar/restaurar uma cópia do banco; o aplicativo não fornece download público do arquivo de demonstração. Reabrir o banco não duplica o arquivo. Uma falha desfaz esquema, arquivo e sinalizadores juntos. Bases v1 sem proveniência não são promovidas automaticamente a base real. Faça backup completo antes de trocar entre versões do programa; versões antigas não compreendem o esquema v2.

## Método de análise

Uma subida contínua começa com incremento do pedal de pelo menos 0,5 ponto percentual (pp), seguindo incrementos acima de 0,2 pp, e deve atingir o limiar configurado (padrão 10 pp). O início é a primeira amostra da subida; a amostra anterior fornece a base. Rampas lentas e ruído podem exigir outro detector.

A resposta é a primeira amostra com aumento da borboleta de pelo menos 3 pp ou do RPM de 100 em relação à base. O atraso usa timestamps sem interpolação. A janela termina após 3 s, ao fim do arquivo ou quando o pedal cai abaixo de 30% da subida. Respostas não observadas são `null`, nunca zero. Medianas consideram somente eventos utilizáveis com resposta observada, acompanhadas da contagem.

O limiar inicial de demora de 0,5 s é exploratório e configurável; não é especificação de fabricante. Carga, marcha, estratégia de torque, aquecimento e aquisição sequencial influenciam os resultados. Uma demora ou DTC não comprova a falha de um componente. Intervalos mínimo, mediano e máximo são informados; baixa resolução, irregularidade e lacunas geram observações, e eventos atravessando lacunas não medem atraso. A análise e o CSV usam todas as amostras; o SVG exportado pode reduzir pontos de visualização.

## Simulação e diagnóstico de leitura

O modelo puro de primeira ordem calcula `alvo = abertura_maxima × (pedal/100)^expoente`, com atraso e constante de tempo positiva. Não estima RPM, torque, desempenho ou calibração real. As curvas são identificadas como derivadas.

O pacote `auto_ecu_lab.diagnostics` conecta somente por comando explícito. Instale dependências opcionais com `python -m pip install -e ".[hardware]"`. Liste integrações sem conectar usando `python -m auto_ecu_lab.diagnostics integrations`. Serial USB/Classic usa pySerial; Wi-Fi usa TCP com host/porta explícitos; BLE usa Bleak e UUIDs documentados. A PWA não abre automaticamente portas locais. J2534, Rasther III/S direto e outros scanners dependem de driver, SDK e autorização. Consulte [docs/diagnostics.md](docs/diagnostics.md). Não houve validação em hardware físico.

**Sem gravação na ECU, remapeamento, apagamento de DTC, testes de atuadores ou alteração de segurança/emissões.**

## Testes e organização

```bash
python -m pytest -q
```

A suíte usa bancos temporários, transportes simulados e fixtures sintéticas exclusivamente em `tests/fixtures/`. Esses arquivos não são carregados pelo aplicativo, não têm rota de download e não entram na base real. Para regenerar as fixtures de teste: `python -m tests.generate_fixtures`.

Os testes verificam análise matemática, ausência de resposta, lacunas, importação atômica, exportação, CSRF, migração v1/v2 com reversibilidade dos originais, falha com rollback, classificação de proveniência, separação de coortes, deduplicação e aquisição de leitura com mocks. Nenhum teste acessa ECU ou banco real do usuário.

Verificação opcional com navegador: `python -m pip install playwright`, `python -m playwright install chromium`, depois `python scripts/smoke_browser.py` com a aplicação em execução. O script verifica telas e layout móvel na base vazia; se houver ensaio, também verifica gráficos, simulação e downloads.

```text
src/auto_ecu_lab/
  models.py       # Tipos e validação
  importers.py    # CSV de parâmetros e DTC
  analysis.py     # Eventos e medições
  provenance.py   # Contrato de origem documental
  statistics.py   # Coortes e resumos reais
  simulation.py   # Modelo matemático separado
  storage.py      # SQLite e migração v2
  reports.py      # JSON, CSV e SVG portáveis
  diagnostics/    # Transportes e consultas de leitura OBD-II
  web.py          # Rotas Flask
  templates/      # Interface em português
  static/         # Tema preto/cinza/laranja/branco, sem CDN
tests/fixtures/   # Dados artificiais isolados para testes
docs/            # Arquitetura e diagnóstico
```

Novos scanners devem preservar origem, unidade, definições dos canais e condições de aquisição. Veja [docs/architecture.md](docs/architecture.md).
