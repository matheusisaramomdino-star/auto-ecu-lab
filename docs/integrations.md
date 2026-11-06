# Integrações de scanners e operação real

O código existente de análise, gráficos, simulação, exportação e armazenamento permanece disponível. A expansão acrescenta identidade da oficina, catálogo e uma camada separada de diagnóstico real. A PWA continua instalável no Windows, Android e iOS; instalação da interface e acesso físico ao scanner são capacidades diferentes.

## Estado dos scanners

| Scanner/caminho | Disponibilidade em software | Dependências e limite |
| --- | --- | --- |
| ELM327 documentado | Consultas OBD-II genéricas de leitura por transporte implementado | Firmware e protocolo compatíveis, canais realmente suportados, documentação do adaptador, API/driver de conexão e validação em hardware |
| J2534 | Ponto de integração nativa condicionado | Driver PassThru e SDK do fabricante no Windows, arquitetura compatível e testes do dispositivo; o site não carrega DLLs |
| Rasther III/S | Importação CSV preservada; comunicação direta condicionada | Um CSV real ainda é necessário para comprovar o layout. Comunicação direta exige documentação/SDK e integração autorizada da Tecnomotor |
| Outros scanners | Contrato para adaptadores futuros | SDK, licença, protocolo documentado e ensaios por plataforma/dispositivo |

A página comercial do Rasther III/S confirma a existência do produto; não comprova um SDK público nem autoriza reconstruir seu protocolo. Nenhum protocolo proprietário, serviço Bluetooth ou driver é inventado para demonstrar integração.

## Separação dos modos

- **Simulação:** aplica um modelo matemático aos sinais carregados pelo operador. Não abre transporte físico nem altera as amostras medidas. A versão 2.2 não distribui cenários fictícios; eles existem somente como fixtures dos testes.
- **Diagnóstico real:** requer ação explícita para selecionar/conectar um adaptador; preserva a origem dos dados, o canal/ECU e os sinais indisponíveis. As consultas usam serviços padronizados de leitura suportados pelo veículo.
- **Integração pendente:** apresenta requisitos e estado indisponível/condicionado, sem fabricar conexão, VIN, códigos ou valores.

O projeto não inclui gravação de firmware, reprogramação, codificação, apagamento de DTC, rotinas de atuadores, alteração de segurança ou emissões. Nem a presença de um scanner na lista nem um ensaio sintético habilitam esses procedimentos.

## Dados e relatórios

As amostras reais e as simulações devem ser identificadas separadamente. Uma resposta ausente ou inválida não é medida zero; um PID não suportado é indisponível. Em múltiplas respostas de ECU, não se deve juntar VINs ou tratar dados de módulos diferentes como um único sinal. Identificação genérica por VIN, CALID ou CVN não comprova fabricante/família da central.

A base estatística exige proveniência e os sinais válidos, além do rótulo de operação real. Dados não verificados continuam disponíveis para análise individual, mas ficam fora das contagens estatísticas. O repositório conectado ainda não forneceu um dataset de aquisição; não foram criadas estatísticas para substituí-lo. Contratos, deduplicação, coortes e migração dos exemplos legados estão em [REAL_DATA.md](REAL_DATA.md).

Relatórios devem guardar transporte, adaptador, origem da ECU, instante da leitura, parâmetros de análise, eventuais sinais ausentes e limites do teste. A análise de pedal/borboleta/RPM exige os quatro canais válidos e timestamps crescentes. Aquisição sequencial do scanner continua sendo uma limitação da interpretação do atraso.

## Validação e expansão

Os testes automatizados verificam interpretação de respostas, falhas de aquisição, limites, persistência e separação entre modos, usando fakes/mocks. O ambiente não dispõe de scanners ou veículos. Antes de declarar um modelo de scanner operacional, são necessários ensaios com o hardware, driver/SDK correto e veículo/alimentação em condições adequadas.

Para acrescentar um scanner, implemente o contrato de transporte separado do decoder, restrinja os comandos a operações de leitura, exponha capacidades e falhas de forma explícita e registre a documentação/licença usada. SDKs e drivers proprietários permanecem fora do repositório até existir autorização para sua distribuição.
