# Desenvolvimento v2.2 · Auto Elétrica Doidinho

A entrega mantém o repositório e a identidade de hospedagem existentes. A análise CSV, as simulações matemáticas, os relatórios e o IndexedDB permanecem disponíveis. A base começa vazia e não distribui dados fictícios; fixtures sintéticas existem somente nos testes. O esquema de backup continua na versão 1. A migração arquiva localmente exemplos legados comprovados antes de removê-los da base ativa e preserva medições reais ou não verificadas. Nenhum backup antigo é promovido automaticamente a coleta real. Os critérios da nova base estão em [REAL_DATA.md](REAL_DATA.md).

## Estrutura

- `dist/core.mjs`, `chart.mjs`, `report.mjs`: análise e visualização preservadas, com origem explícita nos relatórios.
- `dist/modes.mjs`: separa `simulation`, `imported` e `real`. Impede classificar dados fictícios como medições reais.
- `dist/real-base.mjs`: identifica exemplos legados por flags ou hashes conhecidos, arquiva cópias independentes e confirma a migração antes de atualizar a base ativa.
- `dist/statistics.mjs`: valida proveniência, exclui simulações/duplicatas e calcula estatísticas locais em coortes compatíveis; ausência de dados não gera valores de exemplo.
- `dist/catalog.mjs`: marca, veículos, scanners e matriz de conexões. Cadastro de modelo não certifica cobertura de ECU.
- `dist/obd.mjs`: protocolo ELM327 documentado, perfil CAN de 11 bits, ISO-TP, seleção de ECU, descoberta de PIDs e consultas permitidas.
- `dist/transports.mjs`: BLE GATT e Web Serial, com seleção e permissão explícitas. O suporte é detectado em tempo de execução; o nome do sistema não substitui a API real do navegador.
- `dist/connections.mjs`: monitor real e coleta sequencial, sem usar geradores ou curvas do simulador. Dados ausentes são `null`. Uma desconexão interrompe a sessão e preserva o registro parcial para exportação JSON.
- `python/`: cópia completa do projeto Python preservado, incluindo o novo pacote `auto_ecu_lab.diagnostics`. Não contém ambiente virtual, banco de usuário ou credenciais.
- `tests/`: testes Node de núcleo, DOM em memória, transporte, protocolo, cache, relatório, backup e concorrência. `python/tests/` conserva os testes Python e adiciona testes dos transportes com substitutos.

## Operação real

Nenhuma conexão é iniciada ao abrir a página, restaurar um backup ou executar uma simulação. A área **Conexões e scanners** exige escolha de veículo, adaptador e confirmação da consulta real. O navegador exibe sua própria seleção/permissão.

O ELM327 configura apenas a apresentação do adaptador e faz consultas de leitura: serviço 01 para PIDs anunciados, 09 para VIN/CALID/CVN e 03/07/0A para DTCs. Não existe console arbitrário. Apagar DTCs (04), escrita, programação, desbloqueio e atuação não são implementados. Uma seleção explícita é exigida quando várias ECUs respondem; dados de módulos diferentes não são concatenados.

Os canais são consultados em sequência. Timestamps por canal acompanham a coleta e precisam ser considerados no estudo do atraso. A análise existente exige pedal, borboleta e RPM completos. Se um canal estiver ausente, é possível exportar o registro bruto, mas ele não é preenchido com zero nem com uma simulação para entrar na análise.

## Limites de integração

Windows/Android/iOS executam a PWA de análise, simulação e relatórios. Operação real depende do navegador e do hardware. BLE exige UUIDs publicados pelo fabricante; USB ou Classic exigem uma API serial e um dispositivo/driver compatíveis. Wi-Fi TCP está implementado no Python; a página HTTPS não abre sockets TCP nem instala uma ponte local automaticamente.

J2534 permanece pendente de driver/DLL e adaptador autorizado. Rasther III/S conserva o CSV adaptável e exige SDK/API autorizado para conexão direta. Outros scanners dependem de SDK/licença. Não houve engenharia reversa, simulação de conexão ou alegação de teste em equipamento físico.

## Verificação e atualização

```bash
npm ci
npm test
npm run check
cd python
python -m pip install -e ".[dev]"
python -m pytest -q
```

Os testes automatizados não abrem portas reais nem descobrem dispositivos Bluetooth. Um DOM em memória verifica fluxos da aplicação e a ausência de conexão automática; isso não substitui testes em Safari/Chrome ou aparelhos físicos. Fixtures sintéticas permanecem fora do diretório distribuído.

O service worker usa cache `v4` e prepara também os módulos de migração e estatísticas para uso offline. A política de atualização automática já existente verifica operações, salvamentos, rascunhos e todas as abas antes de aplicar uma versão; a verificação e aplicação manuais continuam disponíveis em **Sistema e atualizações**. O manifesto conserva `id`, `scope` e `start_url`, mantendo o mesmo ícone instalado. As gravações no IndexedDB mantêm a verificação de revisão para recusar sobrescrita por abas antigas.
