# Estudo público de produtos semelhantes

Consulta em 5 de novembro de 2026. Este documento registra recursos descritos pelos próprios fabricantes e propostas de implementação independente para o AUTO ECU LAB. Não houve acesso a binários, desmontagem de firmware, cópia de código, extração de SDK ou investigação de protocolos proprietários.

## Fatos observados nas fontes oficiais

| Produto e fonte | Recurso documentado | Padrão de uso observado |
| --- | --- | --- |
| [Car Scanner — Data recording](https://www.carscanner.info/records/) | Exibe parâmetros gravados em gráficos separados ou combinados, com zoom e seleção de valores; exporta CSV e BRC. A documentação informa que CSV não é aceito como importação de gravação no produto. | Rever uma sessão e escolher os sinais relevantes antes de comparar curvas. |
| [Car Scanner — FAQ](https://www.carscanner.info/faq/) | Disponibiliza perfis de conexão e orienta usar um perfil OBD-II da marca quando o modelo não estiver listado. Os sensores disponíveis variam conforme a ECU. | Diferenciar seleção de perfil e capacidade efetivamente encontrada no veículo. |
| [OBDLink — Dashboard gauges](https://support.obdlink.com/support/solutions/articles/43000678883-add-and-edit-dashboard-gauges) | Permite editar instrumentos, criar painéis para veículos diferentes e reordenar painéis. | Personalizar o acesso aos sinais usados com frequência. |
| [OBDLink — Logs](https://support.obdlink.com/support/solutions/articles/43000709894-get-started-with-logs) | Documenta seleção de PIDs, gravação automática ou manual e exportação CSV. Informa que mais PIDs podem reduzir a frequência de atualização. | Dar ao operador controle sobre a sessão e mostrar limites de aquisição. |
| [OBDLink — Vehicle settings](https://support.obdlink.com/support/solutions/articles/43000682239-edit-your-vehicle-settings) | Tenta preencher dados por VIN e oferece preenchimento manual quando a leitura ou decodificação não é possível. | Permitir cadastro útil mesmo sem identificação automática completa. |
| [OBD Auto Doctor — Features](https://www.obdautodoctor.com/features/) | Documenta gráficos de sensores, exportação CSV, salvamento de gráficos como imagem e consulta de VIN, ECU, CALID e CVN. A velocidade das leituras depende do veículo, adaptador e conexão. | Relacionar gráficos, identificação e arquivos exportáveis sem tratar a frequência como garantida. |

Esses recursos documentados não comprovam desempenho, cobertura dos veículos do catálogo do AUTO ECU LAB nem equivalência entre scanners. Não foram testados fisicamente neste estudo. As funcionalidades comerciais variam por plataforma, plano e equipamento.

## Atualização no mesmo aplicativo

As páginas oficiais [OBDLink — Logs](https://support.obdlink.com/support/solutions/articles/43000709894-get-started-with-logs) e [Vehicle settings](https://support.obdlink.com/support/solutions/articles/43000682239-edit-your-vehicle-settings) orientam obter a versão atual pela App Store ou pelo Google Play. Essas fontes **não demonstram atualização automática de uma PWA**.

Manter o AUTO ECU LAB no mesmo endereço e ícone instalado, recebendo versões web publicadas, é uma decisão independente do projeto. Não significa atualizar firmware do scanner ou da ECU. O funcionamento concreto depende da implementação do service worker e do navegador; disponibilidade de versão nova exige acesso à hospedagem. Os dados locais não devem ser apagados durante essa troca de versão, e o backup continua necessário contra limpeza de armazenamento ou troca de aparelho.

## Três melhorias propostas para a base existente

As sugestões abaixo são inferências de projeto, **não alegações de recursos já implementados nem cópias de interface**:

1. **Central Sistema:** concentrar versão instalada, versão disponível, estado offline, notas da versão, verificação de atualização e backup. Aplicar uma atualização somente em momento seguro, preservando cadastros e preferências. Esta é a prioridade pedida pelo usuário: continuar no mesmo app, sem adicionar outro ícone.
2. **Preferências de navegação e painel:** permitir escolher a tela inicial e os atalhos mais usados no aparelho. Aproveitar os gráficos existentes de pedal, borboleta e RPM; manter veículo, ECU e origem da sessão visíveis. Não incluir um painel flutuante: o usuário esclareceu que “flutuante” significa atualizar o aplicativo existente.
3. **Rastreabilidade das sessões:** aproveitar os relatórios e exportadores existentes para reunir data, veículo, origem dos dados, identificação disponível e limitações de amostragem. Conservar a separação explícita entre simulação, CSV importado e leitura real. Ausência de PID não deve virar uma medição zero.

Nenhuma proposta amplia a aquisição para funções OEM sem documentação e autorização. J2534, Rasther III/S direto e outros SDKs seguem dependentes das integrações legítimas correspondentes. Este estudo não recomenda comandos de escrita, limpeza de DTC, testes de atuadores ou mudanças de segurança e emissões.
