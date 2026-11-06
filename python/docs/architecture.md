# Arquitetura

O núcleo usa somente a biblioteca padrão do Python; Flask atende a interface. Não há dependência de serviços, bibliotecas de gráficos remotas ou hardware automotivo.

```text
CSV → importers → Sample / DiagnosticCode → analysis → AnalysisResult → reports
                          ↓                     ↑
                      storage SQLite ← web Flask → templates / gráficos SVG
                          ↓
                 simulation (cópia derivada)
```

`create_app(config)` permite banco temporário e chave configuráveis em testes; a inicialização nunca gera dados. Os módulos de análise e simulação não importam Flask ou SQLite, e recebem estruturas validadas. `ValidationError` representa erros apresentáveis em português.

O repositório mantém veículos e ensaios. Cada ensaio guarda as amostras, metadados de importação, SHA-256 de arquivos reais, cópia do veículo/ECU, DTCs e parâmetros de análise. O resultado é recalculado de forma determinística. A simulação permanece transitória e nunca substitui as amostras. Seus parâmetros acompanham o CSV exportado.

A importação valida os dois arquivos antes da transação que cria o ensaio. As substituições de DTCs são transações próprias, associadas a um ensaio específico. Não há descarte silencioso de dados. O banco usa chaves estrangeiras, consultas parametrizadas e versão de esquema 2. Formulários e a API de simulação usam token CSRF; texto importado é escapado nos templates; CSV protege texto interpretável como fórmula.

Pontos de expansão:

- **Scanners:** criar adaptadores que retornem os tipos do domínio; preservar unidades e proveniência. Validar com exportações reais antes de declarar compatibilidade.
- **Análise:** acrescentar detectores de rampa com ruído, sensores redundantes e comparação entre ensaios. Cada regra deve expor evidência, parâmetros e limites. Não inferir defeito exclusivamente de diferenças entre pedal e borboleta.
- **Persistência:** adicionar migrações sequenciais antes de mudar o esquema. Não alterar bancos existentes silenciosamente. Novos modelos de veículo permanecem dados de cadastro.
- **Relatórios:** adicionar exportadores consumindo `report_payload`, sem duplicar o cálculo dos eventos.
- **Simulação:** implementar outros modelos puros e verificáveis, identificados como dados derivados. O projeto não inclui escrita ou atuação; o componente opcional de diagnóstico fornece somente consultas documentadas de leitura.

O servidor de desenvolvimento local não foi projetado para serviço público ou uso simultâneo de vários usuários. Instalações locais devem proteger o arquivo SQLite e os relatórios que contêm identificação do veículo. A aplicação não transmite esses dados.

## Base real e proveniência

`provenance.py` valida contratos documentais; `statistics.py` calcula resumos puros por coorte. O indicador `is_demo = 0`, isoladamente, não confirma uma medição real. Captura por protocolo exige origem ECU recebida, identificador de captura, início de conexão com fuso e hash dos bytes do CSV. Um relatório CSV exige declaração do operador, origem e data da captura. Um dataset exige URL HTTPS, revisão e licença explícitas. Repositório de código, catálogo de PIDs e fixtures não contam como capturas.

Coortes separam veículo/motor, ECU/HW/SW, definição de cada sinal, fonte, intervalo mediano e parâmetros de análise. Ausências de identificação restringem comparação ao veículo; canais não documentados restringem ao ensaio. Registros duplicados e sem proveniência são excluídos com motivos contáveis. Hashes dos exemplos legados, incluindo relatório DTC, são recusados mesmo com confirmação do operador; o hash permite reconhecer esses arquivos exatos, sem prometer identificar qualquer dado fabricado. Não existe cálculo global de atraso entre modelos diferentes nem substituição de ausência por zero.

A migração v1 → v2 usa uma única transação explícita para DDL, cópia JSON em `demo_archive`, sinalizador `archived` e `PRAGMA user_version = 2`. Demonstrações saem da lista ativa sem remover os originais. Registros reais, metadados e snapshots anteriores permanecem intactos; não são promovidos automaticamente às estatísticas. O arquivo local preserva ensaio e veículo para recuperação. Falhas restauram a versão anterior inteira.

Geradores e CSVs artificiais ficam exclusivamente em `tests/fixtures/`; não são parte do pacote de produção. Não existem rotas `/demonstracao` ou `/exemplos`. A simulação continua pura e transitória, sem escrever amostras, proveniência ou estatísticas.
