# Plataformas e conexões

AUTO ECU LAB — Auto Elétrica Doidinho mantém a PWA de análise CSV, gráficos, simulações, relatórios e backup. O catálogo de Hilux, SW4, Strada 2022 1.4, S10, Ranger, L200 e Amarok serve ao cadastro: não é uma certificação dos anos/motores nem identifica automaticamente a ECU.

Os novos caminhos de diagnóstico real ficam separados da simulação. A disponibilidade exige detectar a API real do navegador, selecionar o dispositivo com permissão e conhecer o transporte do adaptador. Não abrimos conexões durante o carregamento da página. Testes automatizados usam respostas artificiais; não houve ensaio físico com scanner ou veículo.

| Plataforma | BLE | Bluetooth Classic | Wi-Fi ELM327 | USB |
| --- | --- | --- | --- | --- |
| Windows | Web Bluetooth em navegador compatível, GATT/UUIDs documentados; alternativa nativa conforme dependências | Web Serial/RFCOMM ou COM quando a API e o driver estiverem disponíveis | Transporte TCP local/nativo; o navegador não abre TCP bruto | Web Serial para adaptador serial compatível; driver necessário. J2534 depende de integração específica |
| Android | Chrome compatível, API detectada e permissões; depende do GATT do adaptador | Detectar `navigator.serial`: versões Chromium com RFCOMM podem oferecer suporte; não inferir apenas pelo sistema | Requer integração local/nativa ou ponte configurada | USB OTG não basta; depende de API/driver/SDK. WebUSB não fornece automaticamente serial genérico |
| iOS/Safari/PWA | Web Bluetooth indisponível; requer app nativo/SDK autorizado | Web Serial/RFCOMM indisponível; acessório nativo depende de regras e SDK específicos | Sem TCP bruto no site; requer caminho nativo/ponte validado | Web Serial/WebUSB indisponíveis; USB-C não implica uma API de scanner |

Uma página HTTPS não pode simplesmente usar `fetch()` para qualquer endereço HTTP local de scanner e ser declarada compatível: há limites de conteúdo misto, acesso à rede local, autenticação e ausência de protocolo HTTP nos adaptadores TCP. O acesso via ponte precisa ser projetado e autorizado para o ambiente de destino.

Bluetooth BLE e Classic são transportes diferentes. Web Bluetooth usa GATT e não acessa um perfil SPP Classic. O ELM327 define comandos de adaptador e consultas OBD; ele não define um serviço BLE universal. Os UUIDs de escrita/notificação devem vir da documentação do adaptador, sem assumir que um clone adota um perfil específico.

## Veículos

Somente a Strada tem ano e motor informados pelo requisito: 2022, 1.4. Para os outros modelos, o cadastro exige o ano/motor correto do veículo analisado. PIDs suportados, protocolos, endereços de resposta e módulos variam. A falta de um PID de pedal ou borboleta não pode ser substituída por zero para fazer a análise parecer completa.

## Referências

- [Web Serial — Chrome](https://developer.chrome.com/docs/capabilities/serial)
- [Dados de compatibilidade Serial — MDN](https://github.com/mdn/browser-compat-data/blob/main/api/Serial.json)
- [Web Bluetooth — Chrome](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Web Bluetooth — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [Rasther III/S — Tecnomotor](https://tecnomotor.com/conheca-a-tecnomotor/produtos/rasther/rastheriii-s/)

As APIs e permissões evoluem; a aplicação deve testar a presença das interfaces e apresentar a limitação observada, sem prometer compatibilidade por marca de sistema ou nome de scanner.

## Revisão 2.3

Consulte o [relatório de licenças e módulos](compatibility-report.md) para as seis referências auditadas. Os cards operacionais mostram somente o ELM327 implementado. A inspeção BIN e suas vistas2D/3D são locais e independem do scanner. Novos sensores são consultas pontuais somente na versão web; a CLI Python mantém seus canais existentes. Não houve validação em hardware nesta entrega.
