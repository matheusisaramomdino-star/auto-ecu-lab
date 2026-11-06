/** Catálogo de cadastro e capacidades. Não identifica a ECU nem certifica veículos. */
export const BRAND = Object.freeze({
  name: "AUTO ECU LAB — Auto Elétrica Doidinho",
  workshop: "Auto Elétrica Doidinho",
  colors: Object.freeze({
    black: "#141414",
    gray: "#242424",
    orange: "#FF8A00",
    white: "#FFFFFF",
  }),
});

export const VEHICLES = Object.freeze(
  [
    {
      key: "hilux",
      brand: "Toyota",
      model: "Hilux",
      engine: "",
      year: null,
      label: "Toyota Hilux",
    },
    {
      key: "sw4",
      brand: "Toyota",
      model: "SW4",
      engine: "",
      year: null,
      label: "Toyota SW4",
    },
    {
      key: "strada-2022-14",
      brand: "Fiat",
      model: "Strada",
      engine: "1.4",
      year: 2022,
      label: "Fiat Strada 2022 1.4",
    },
    {
      key: "s10",
      brand: "Chevrolet",
      model: "S10",
      engine: "",
      year: null,
      label: "Chevrolet S10",
    },
    {
      key: "ranger",
      brand: "Ford",
      model: "Ranger",
      engine: "",
      year: null,
      label: "Ford Ranger",
    },
    {
      key: "l200",
      brand: "Mitsubishi",
      model: "L200",
      engine: "",
      year: null,
      label: "Mitsubishi L200",
    },
    {
      key: "amarok",
      brand: "Volkswagen",
      model: "Amarok",
      engine: "",
      year: null,
      label: "Volkswagen Amarok",
    },
  ].map(Object.freeze),
);

export const SCANNERS = Object.freeze(
  [
    {
      key: "elm327",
      name: "ELM327 documentado",
      status: "implementado",
      description:
        "Consultas OBD-II genéricas de leitura, conforme PIDs e protocolo oferecidos pelo veículo. A presença no catálogo não certifica adaptadores ou clones.",
      connectionTypes: ["Bluetooth BLE", "Bluetooth Classic", "Wi-Fi", "USB"],
      requirements: [
        "Documentação do adaptador e firmware compatível",
        "API de conexão disponível ou transporte Python configurado",
        "UUIDs GATT documentados para BLE",
        "Validação em bancada e veículo antes do uso operacional",
      ],
    },
    {
      key: "j2534",
      name: "J2534",
      status: "depende",
      description:
        "Integração nativa depende de driver PassThru do fabricante, arquitetura compatível e implementação validada. O site não carrega DLL J2534.",
      connectionTypes: ["USB", "Wi-Fi"],
      requirements: [
        "Windows com driver e SDK autorizado do fabricante",
        "Biblioteca compatível com a arquitetura do processo",
        "Validação do dispositivo e protocolo",
        "Somente operações de diagnóstico de leitura previstas pelo projeto",
      ],
    },
    {
      key: "rasther",
      name: "Rasther III/S",
      status: "depende",
      description:
        "A importação de CSV continua disponível. Comunicação direta depende de documentação, SDK ou integração autorizada da Tecnomotor; não há protocolo proprietário presumido.",
      connectionTypes: [],
      requirements: [
        "Exportação real para validar o layout de CSV",
        "Autorização e documentação da Tecnomotor para comunicação direta",
        "Teste do SDK e conexão no dispositivo alvo",
      ],
    },
    {
      key: "sdk",
      name: "Outros scanners via SDK",
      status: "depende",
      description:
        "Conectores adicionais só podem ser ativados após integração do SDK, verificação da licença e testes do fabricante.",
      connectionTypes: [],
      requirements: [
        "SDK e licença do fornecedor",
        "Documentação de protocolo e transporte",
        "Mapeamento de recursos de leitura",
        "Validação de plataforma e hardware",
      ],
    },
  ].map(Object.freeze),
);

export const CONNECTION_MATRIX = Object.freeze(
  [
    {
      platform: "Windows",
      connection: "Bluetooth BLE",
      status: "depende",
      browser: "Chrome/Edge com navigator.bluetooth disponível",
      description:
        "Web Bluetooth usa GATT e exige seleção explícita do dispositivo e UUIDs do adaptador. O suporte é detectado pela API, não apenas pelo sistema operacional.",
      nativeRequirement:
        "Transporte BLE nativo opcional exige biblioteca e hardware compatíveis.",
    },
    {
      platform: "Windows",
      connection: "Bluetooth Classic",
      status: "depende",
      browser: "Chrome/Edge com navigator.serial disponível",
      description:
        "Web Serial pode acessar RFCOMM/SPP ou porta COM exposta pelo driver, quando o navegador e o adaptador oferecerem esse caminho. Web Bluetooth não acessa Bluetooth Classic.",
      nativeRequirement:
        "Alternativa serial nativa exige porta, pareamento e driver compatíveis.",
    },
    {
      platform: "Windows",
      connection: "Wi-Fi",
      status: "depende",
      browser: "Sem socket TCP bruto no navegador",
      description:
        "O transporte ELM327 TCP exige aplicação local/nativa ou ponte configurada. Um site HTTPS não pode ser ligado a um IP HTTP arbitrário como solução universal.",
      nativeRequirement:
        "Configurar o transporte TCP local com endereço e porta do adaptador documentados.",
    },
    {
      platform: "Windows",
      connection: "USB",
      status: "depende",
      browser: "Web Serial quando navigator.serial estiver disponível",
      description:
        "Adaptadores USB seriais precisam de driver que exponha uma porta compatível. WebUSB não fornece automaticamente um driver ELM327 serial.",
      nativeRequirement:
        "O transporte serial nativo é uma alternativa; J2534 exige driver/SDK específico.",
    },
    {
      platform: "Android",
      connection: "Bluetooth BLE",
      status: "depende",
      browser: "Chrome compatível com navigator.bluetooth disponível",
      description:
        "Conexão BLE depende do navegador, das permissões, do adaptador GATT e de UUIDs documentados. O usuário escolhe o dispositivo.",
      nativeRequirement:
        "Um aplicativo com SDK autorizado é necessário quando a API do navegador não estiver disponível.",
    },
    {
      platform: "Android",
      connection: "Bluetooth Classic",
      status: "depende",
      browser: "Verificar navigator.serial na versão instalada",
      description:
        "Algumas versões Chromium disponibilizam Web Serial para RFCOMM. O projeto verifica a API real e não bloqueia ou promete suporte apenas pelo nome Android.",
      nativeRequirement:
        "Sem API serial compatível, é necessário aplicativo/SDK nativo autorizado.",
    },
    {
      platform: "Android",
      connection: "Wi-Fi",
      status: "depende",
      browser: "Sem socket TCP bruto no navegador",
      description:
        "Usar uma integração nativa ou ponte autorizada e configurada. A capacidade Wi-Fi do celular não transforma o site em cliente TCP.",
      nativeRequirement:
        "Aplicativo/ponte deve tratar rede local, permissões e autenticação compatíveis.",
    },
    {
      platform: "Android",
      connection: "USB",
      status: "depende",
      browser: "Detecção de API, versão, dispositivo e driver",
      description:
        "USB OTG e WebUSB não garantem comunicação serial. Só usar o caminho de Web Serial se estiver efetivamente disponível e compatível, ou uma integração nativa.",
      nativeRequirement:
        "SDK/driver USB serial autorizado quando o navegador não fornecer o transporte adequado.",
    },
    {
      platform: "iOS",
      connection: "Bluetooth BLE",
      status: "indisponível",
      browser: "Safari/PWA sem Web Bluetooth",
      description:
        "A interface, os CSVs, gráficos e simulações funcionam na PWA. A conexão BLE direta não está disponível neste caminho do Safari.",
      nativeRequirement:
        "Requer aplicativo nativo com CoreBluetooth/SDK autorizado e validação específica; não foi entregue como recurso nativo.",
    },
    {
      platform: "iOS",
      connection: "Bluetooth Classic",
      status: "indisponível",
      browser: "Safari/PWA sem Web Serial/RFCOMM",
      description:
        "O Safari não oferece acesso serial Classic genérico. Compatibilidade de acessórios Classic nativos depende das regras e SDKs do fornecedor/Apple.",
      nativeRequirement:
        "Integração nativa autorizada para o acessório específico; não presumir SPP genérico.",
    },
    {
      platform: "iOS",
      connection: "Wi-Fi",
      status: "depende",
      browser: "Sem socket TCP bruto no navegador",
      description:
        "O site não abre TCP diretamente para ELM327 Wi-Fi. Uma aplicação nativa ou ponte aprovada precisa implementar e validar esse transporte.",
      nativeRequirement:
        "Integração local/nativa com permissões de rede e SDK compatíveis.",
    },
    {
      platform: "iOS",
      connection: "USB",
      status: "indisponível",
      browser: "Safari/PWA sem Web Serial/WebUSB",
      description:
        "A presença de USB-C ou adaptador no aparelho não fornece uma API serial ao site.",
      nativeRequirement:
        "Necessita solução nativa/SDK aprovada para o acessório e dispositivo específicos.",
    },
  ].map(Object.freeze),
);

export const CONNECTION_STATUSES = Object.freeze({
  implementado:
    "Implementado em software; hardware e veículo ainda precisam de validação",
  depende: "Depende de API, driver, SDK, permissões ou integração documentada",
  indisponível: "Indisponível no caminho de navegador indicado",
});
