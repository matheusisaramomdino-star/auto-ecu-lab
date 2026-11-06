# Base real e estatísticas — versão 2.2

O AUTO ECU LAB começa com a base vazia. Não distribui medições de veículos, médias de mercado ou taxas de falha inventadas. Estatísticas só aparecem a partir dos registros locais que cumprem os critérios abaixo. Os dados de teste são sintéticos e ficam exclusivamente nas pastas de testes, sem serem carregados pelo site ou pela base operacional. O ZIP do projeto Python pode incluir essas fixtures para executar a suíte de testes, identificadas como sintéticas.

## Repositório conectado e disponibilidade dos dados

O repositório [matheusisaramomdino-star/auto-ecu-lab](https://github.com/matheusisaramomdino-star/auto-ecu-lab) foi identificado na revisão [`3cd65267552d35051754381fa0df576ea2cb8095`](https://github.com/matheusisaramomdino-star/auto-ecu-lab/tree/3cd65267552d35051754381fa0df576ea2cb8095). Essa revisão contém apenas um README de objetivos, sem CSV, logs de scanner ou outro dataset de aquisição. Nenhum dado real estava disponível nessa origem, e nenhuma medição foi importada dela.

A conexão de um repositório de código não transforma suas descrições em estatísticas automotivas. Catálogos de modelos, listas de PIDs, código e simulações não contam como medições. Um futuro dataset precisa trazer arquivo original, documentação da aquisição, licença e revisão identificável. Não há busca automática de datasets, sincronização de diagnósticos ou upload dos arquivos do operador.

## Fontes aceitas pelo contrato de proveniência

O módulo [`dist/statistics.mjs`](../dist/statistics.mjs) expõe `provenanceStatus(recording)`, `cohortKey(recording)` e `summarizeRecordings(recordings)`. Ele valida as evidências declaradas e os sinais antes de incluir um registro nas estatísticas. Esse processo não certifica fisicamente uma coleta: um hash identifica conteúdo, e os metadados continuam sendo declarações da origem.

Todo registro elegível exige amostras válidas de `time_s`, `pedal_pct`, `throttle_pct` e `rpm`, além de `metadata.provenance` com:

- `schema_version: 1`;
- `kind` conforme a tabela abaixo;
- `source` e `reference` preenchidos;
- `captured_at` em ISO 8601 com fuso, correspondente à aquisição, não presumido a partir da importação.

| Tipo (`kind`) | Verificação (`verification`) | Evidências adicionais obrigatórias |
| --- | --- | --- |
| `scanner_capture` | `protocol_capture` | `metadata.connection.started_at_utc` com fuso, `metadata.capture_id` ou `metadata.connection.capture_id`, e exatamente uma origem ECU identificada nos metadados da coleta. |
| `scanner_report` | `operator_confirmed` | Confirmação da origem do arquivo pelo operador e SHA-256 de 64 caracteres do arquivo original. |
| `repository_dataset` | `documented_dataset` | `repository_url` HTTPS sem credenciais, `revision` com commit de 40 caracteres, `license` preenchida e SHA-256 do arquivo original. |

O hash pode estar em `metadata.sha256` ou `metadata.provenance.sha256`; quando ambos existem, devem coincidir. Para capturas, as origens ECU são lidas de `metadata.identity.ecuId`, `metadata.connection.adapter.ecuId` e `metadata.channel_timestamps[].ecuId`. Origens diferentes exigem separar os registros.

CSV importado sem proveniência suficiente continua disponível para gráficos, análise individual e exportação. Ele aparece entre as exclusões da base estatística, com o motivo. PID ausente, amostra parcial, origem não verificada ou campos inválidos não são preenchidos com números inventados. Aquisição parcial permanece exportável pelo fluxo de conexão, mas não satisfaz os quatro sinais da análise de atraso.

O status de um scanner depende de protocolo, documentação e implementação autorizada. Rasther III/S permanece por importação de arquivo ou integração autorizada; J2534 e outros SDKs não se tornam conectores operacionais por aparecerem em um cadastro. O sistema continua sem gravação na ECU, programação, atuação ou alterações em segurança e emissões.

## O que as estatísticas significam

`summarizeRecordings` informa totais recebidos, elegíveis, excluídos e duplicados, além dos grupos compatíveis e dos motivos de exclusão. Sem medições elegíveis, os totais ficam em zero e as medidas sem observações ficam ausentes/`null`.

Os grupos consideram marca, modelo, ano, motor, identificação confirmada da ECU, hardware, software, origem ECU da aquisição, definições dos quatro sinais e configuração da análise. Sem identificação suficiente de ECU/HW/SW, o veículo fica isolado; sem `metadata.signal_definitions` ou `metadata.pid_definitions` completos, o registro fica isolado. Não se presume que um cabeçalho de CSV represente o mesmo PID em dois scanners.

Os resultados incluem sessões, veículos, amostras, duração, intervalos de aquisição, lacunas, faixas observadas dos sinais, eventos e atraso observado de borboleta/RPM. Para cada atraso, são mostradas quantidade observada, ausência de resposta, mínimo, máximo, mediana e p95. O p95 usa o posto mais próximo: `ceil(0,95 × n)`. A mediana de uma quantidade par de respostas usa os dois valores centrais.

Ausência de resposta não conta como atraso zero. Eventos que atravessam lacunas são excluídos da medição; intervalos nunca são calculados entre sessões. Não existe mediana global misturando coortes. DTCs são códigos observados: uma sessão só entra como diagnóstico conhecido quando `metadata.diagnostic_result.complete === true`. Uma lista vazia sem consulta documentada não comprova ausência de falhas.

SHA-256 repetido é contado uma vez. Identificador de captura repetido mantém o maior prefixo compatível de amostras; amostras divergentes com o mesmo identificador são sinalizadas como conflito. Reimportar um mesmo arquivo ou salvar novamente uma captura não aumenta a base estatística.

Esses números descrevem apenas os registros locais. Não representam especificações OEM, comportamento normal de um modelo, prevalência de falhas na frota, diagnóstico conclusivo ou ganho de desempenho. Aquisição sequencial, resolução temporal, carga e estratégia de controle continuam limitando a interpretação.

## Migração dos exemplos antigos sem perda de registros

[`dist/real-base.mjs`](../dist/real-base.mjs) identifica simulações apenas por `isDemo === true`, `metadata.operation_mode === "simulation"` ou SHA-256 de um dos arquivos sintéticos antigos conhecidos. Nome do arquivo, aparência do gráfico e ausência de origem não bastam. Registros reais e não verificados são preservados na base ativa.

A migração primeiro grava cópias completas dos registros identificados em um banco IndexedDB independente, `auto-ecu-lab-legacy-archive`. Somente após o término dessa transação grava o novo snapshot da base ativa pelo mecanismo usual de concorrência. Falha de arquivo ou falta de espaço impede o commit. Se o commit falhar, os registros ativos continuam preservados e a cópia arquivada permanece disponível.

O cadastro inicial Fiat Strada 2022 1.4, placa `DEMONSTRAÇÃO`, só sai da base ativa se estiver sem identificação ECU, vinculado a um exemplo removido e sem registros ativos vinculados. Uma ECU preenchida, campo adicional de identificação ou cadastro semelhante sem esse vínculo é preservado. A seleção atual é mantida se ainda existir; caso contrário, seleciona-se o primeiro registro ativo. Repetir a migração não altera uma base já limpa. A restauração de backups antigos passa pela mesma quarentena antes de ativar os registros.

O arquivo local usa os stores `recordings` e `vehicles`, com chave `id`. Cada entrada mantém `archivedAt`, `reason` e o registro completo em `recording` ou `vehicle`. Quando o mesmo ID chega com conteúdo diferente, `previous` conserva a versão anterior; uma repetição idêntica não a substitui. O snapshot de veículo já armazenado no ensaio também é preservado. A cópia conserva o que estava salvo no aplicativo; ela não recria bytes de um CSV original que nunca tenha sido guardado.

Esse arquivo é local e separado do backup usual da base ativa. Mantenha backups anteriores e os arquivos originais do scanner. Limpar dados do site, trocar de perfil ou aparelho pode remover o arquivo local. Para recuperação técnica, os stores podem ser exportados pelo inspetor IndexedDB do navegador; não se deve excluir o banco nem sobrescrever as entradas. Não há envio dessas cópias para hospedagem ou repositório.

## Atualização no ícone existente

A versão 2.2.0 usa o cache `auto-ecu-lab-shell-v4` e prepara `real-base.mjs` e `statistics.mjs` para uso offline. O manifesto mantém `id`, `scope` e `start_url` em `./`, preservando a identidade da instalação existente. A atualização usa o mesmo endereço e ícone; conexões, coletas, salvamentos e alterações pendentes adiam sua aplicação. O módulo Base pode ser aberto pela interface ou por `#base`, mantendo os sete destinos anteriores da navegação principal.

Os testes automatizados verificam proveniência, exclusões, deduplicação, coortes, estatísticas com atrasos conhecidos, ausência de resposta e migração com falhas de arquivo/commit. Dados sintéticos usados nesses testes ficam isolados nas pastas de teste do pacote-fonte; não são carregados pelo aplicativo nem apresentados como estatísticas reais.
