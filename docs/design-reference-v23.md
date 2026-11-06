# Interface da oficina — versão 2.3

A revisão usa navegação e controles de instrumento: funções identificáveis, estado de conexão, nome do canal, unidade e valor. A identidade continua sendo **AUTO ECU LAB — Auto Elétrica Doidinho**, com preto `#141414`, cinza `#242424`, laranja `#FF8A00` e branco `#FFFFFF`. Tons secundários são transparências do branco; o laranja marca ações e seleção.

## Referência consultada

Consulta em **6 de novembro de 2026** às fontes oficiais do OBDLink:

- [Add and Edit Dashboard Gauges](https://support.obdlink.com/support/solutions/articles/43000678883-add-and-edit-dashboard-gauges): documentação atual com capturas de telas iOS e Android. Expõe a separação de conexão, painéis de leitura e configuração de cada instrumento. Também diferencia PIDs disponíveis e não suportados.
- [Get Started with Diagnostics](https://support.obdlink.com/support/solutions/articles/43000711154-get-started-with-diagnostics): organização por códigos, parâmetros e relatório.
- [Guia Android do OBDLink LX, página 2](https://www.obdlink.com/wp-content/uploads/2014/05/lx_bt-android_qsg-web.pdf#page=2): captura da tela principal do aplicativo no guia oficial, consultada como referência de navegação por funções. É um guia antigo; não foi tratado como a interface atual nem como prova de compatibilidade.

A documentação e as capturas públicas foram consultadas pela ferramenta de pesquisa. O código, as marcas, os ícones, as fotografias e os mostradores desses produtos não foram incorporados. As fontes servem de referência de organização; esta interface foi implementada de forma independente.

## Decisões aplicadas

| Área | Aplicação no AUTO ECU LAB |
| --- | --- |
| Navegação | Menu de oficina com rótulos diretos; ações de análise, conexão e arquivos ficam próximas ao trabalho. Sistema permanece acessível pelo cabeçalho no celular. |
| Hierarquia | Título objetivo e descrição curta. Estado de conexão no cabeçalho; dados e formulários abaixo. |
| Dados | Valores com algarismos tabulares, unidade visível e legendas legíveis. A cor não é o único modo de reconhecer um estado. |
| Painéis | Bordas discretas, cantos de 6–8 px e espaçamento baseado em múltiplos de 4/8 px. Não há efeitos de vidro, gradientes ou ilustrações promocionais. |
| Formulários | Rótulos acima dos campos, ajuda junto ao controle e grupos de configuração compactos. No celular, campos passam a uma coluna e usam fonte de 16 px. |
| Tabelas/BIN | Rolagem horizontal limitada ao quadro. Offset, bytes e valores usam representação legível; visualizações continuam vinculadas ao arquivo selecionado. |
| Sem medições | Instrução objetiva para cadastrar, importar ou coletar. Não é preenchido um painel com valores de demonstração. |
| Toque/teclado | Botões e links de ação com altura mínima de 44 px; foco visível em laranja e navegação de até sete itens no celular. |

Não foram adotadas ações de apagar códigos, programar central, atuar em componentes ou alterar emissões presentes em produtos de referência. A referência visual não concede compatibilidade com seus adaptadores ou funções.

## Responsividade e verificação

A folha de estilos trata larguras de 320 px, celular em orientação horizontal, tablet e Windows. Painéis e campos usam trilhas `minmax(0, 1fr)`; tabelas e hexadecimais têm rolagem própria. O rodapé respeita a navegação e a área segura do aparelho. Em telas estreitas, não se reduz o tamanho dos controles para fazer os formulários caberem.

Foram preservados os identificadores usados pelo JavaScript. A validação estrutural de HTML e a análise sintática de CSS complementam os testes de integração DOM do projeto. **Não houve verificação visual em Safari, Chrome ou dispositivo físico nesta sessão**: o ambiente gerenciado não disponibilizou o controle de navegador exigido pelo fluxo Sites. Nenhum servidor de prévia, navegador alternativo ou Playwright foi iniciado.
