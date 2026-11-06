# Atualizações no mesmo aplicativo

## O que o usuário precisa fazer

Continue usando o mesmo endereço e o ícone já instalado. Não instale outra cópia e não limpe o armazenamento para atualizar. Na primeira passagem da versão 2.0 para 2.1, abra com internet, conclua as operações e use o botão **Atualizar agora** já existente, ou feche todas as abas/janelas do aplicativo e reabra o mesmo ícone. Isso permite ao navegador ativar o novo service worker sem reinstalação.

A partir da versão 2.1, a política padrão aplica atualizações automaticamente quando o aplicativo está livre. Em **Sistema e atualizações**, é possível verificar manualmente, conferir as versões em uso/publicada, escolher atalhos e desligar a aplicação automática. Novos módulos continuam chegando por esse mesmo mecanismo; nenhuma versão gera outro ícone.

Verificações acontecem na abertura, ao voltar para a janela, ao recuperar conexão e a cada dez minutos enquanto o ambiente permitir. Não é uma promessa de execução contínua em segundo plano: o sistema operacional pode suspender a PWA. Sem internet, continua funcionando a versão já preparada. O navegador baixa os novos arquivos automaticamente quando conectado; o usuário não precisa baixar outro instalador.

## Proteção do trabalho em andamento

A aplicação consulta o estado real, não apenas um contador de tempo. Uma atualização é adiada enquanto houver conexão/coleta, consulta, gravação local, importação/restauração, arquivo selecionado ou formulário não salvo. Dados reais adquiridos mas ainda não salvos também impedem a reabertura, inclusive depois da desconexão do adaptador. É possível retornar à coleta, exportar o registro bruto ou descartá-lo explicitamente; o app não presume que gerar um download significa que o arquivo foi salvo no telefone.

O worker pede confirmação de todas as abas do mesmo aplicativo. Cada aba trava novas operações antes de confirmar. Se alguma não responder, estiver ocupada ou uma nova janela aparecer durante a verificação, a atualização é adiada e as travas são liberadas. Antes de reabrir, o cliente confere novamente as condições. Esse fluxo não envia comandos ao veículo.

O botão legado da versão 2.0 mantém sua ação manual para permitir a primeira migração. As novas guardas não podem ser injetadas retroativamente num JavaScript antigo que já está executando; por isso a primeira atualização deve ser feita com as operações encerradas. Depois da migração, a coordenação passa a ser automática entre clientes compatíveis.

## Dados e preferências

O banco e o esquema dos ensaios não mudaram. Atualizar o shell não apaga IndexedDB, veículos, medições, DTCs ou critérios. O cache da geração anterior é conservado como apoio de recuperação; cache não é backup dos dados de diagnóstico.

As preferências ficam num banco separado (`auto-ecu-lab-preferences`) para que editar atalhos ou a política de atualização não substitua o workspace. Parâmetros do simulador são preservados depois de comparar/aplicar um perfil. Essas preferências pertencem ao aparelho e não entram automaticamente no backup de ensaios já existente.

O acesso configurado no Sites é preservado. Nesta publicação o site estava público; isso não transmite os arquivos locais dos usuários. A atualização não cria conta adicional, outro domínio ou uma segunda instalação.

## Organização para futuras melhorias

- `modules.mjs`: registro das ferramentas, versão do produto e guardas locais de trabalho.
- `preferences.mjs`: preferências locais, independentes do diagnóstico.
- `updates.mjs`: registro/check do worker, coordenação entre abas, estado da central e reabertura protegida.
- `release.json`: versão publicada e resumo das mudanças; nenhum código remoto é avaliado a partir desse JSON.
- `sw.js`: preparo completo do shell, cache versionado, acordo entre clientes e disponibilidade offline.
- `scripts/check-release.mjs`: verifica coerência da versão do produto/pacote/cache e presença dos módulos no shell.

Para publicar novas funcionalidades, altere o código no repositório atual, incremente a versão em `modules.mjs`, `package.json` e `release.json`, avance `CACHE_VERSION` em `sw.js`, execute os testes/check e publique no mesmo projeto. Preserve `id`, `scope` e `start_url` do manifesto e o `project_id` existente. Um SDK/driver nativo do Windows ou uma mudança de sistema operacional continua tendo seu próprio ciclo de instalação; a atualização web não instala binários do fabricante.

## Comparação pública e limites de verificação

O estudo de ferramentas similares e as decisões de reimplementação independente estão em [public-product-study.md](public-product-study.md). Não foi feita cópia de código, firmware, SDK ou protocolo proprietário. O estudo não comprova que produtos de lojas usam este mecanismo PWA.

Os testes automáticos exercitam worker em VM, timers/eventos, múltiplas janelas, guardas e DOM/IndexedDB em memória. Não substituem verificação em aparelhos físicos. O ambiente gerenciado não ofereceu a ferramenta CUA exigida para prévia do Sites; não foi improvisado outro caminho de controle de navegador.
