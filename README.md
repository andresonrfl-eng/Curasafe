# CuraSafe

PWA pessoal para registrar uma rotina de medicamentos já definida pelo usuário e acompanhar familiares autorizados. Mantém a caixa em quatro períodos, cores e formas farmacêuticas do protótipo. Não interpreta sintomas nem sugere tratamentos ou doses.

## Publicar no GitHub Pages

1. Incorporar esta alteração à branch `main`.
2. Em **Settings → Pages**, selecionar **Deploy from a branch**, `main` e `/ (root)`.
3. Aguardar o GitHub concluir a publicação e abrir `https://andresonrfl-eng.github.io/Curasafe/`.
4. No Android, abrir no Chrome e escolher **Instalar app** ou **Adicionar à tela inicial**. A instalação e as notificações dependem do navegador e do dispositivo.

Todos os arquivos estáticos estão prontos para publicação; não é necessário executar um build no GitHub Pages. Caminhos relativos permitem hospedagem em `/Curasafe/`. O endereço antigo redireciona para o novo `index.html`.

## O que mudou

- Intervalos usam timestamps contínuos e uma data inicial: começar às 22h e repetir a cada 8h gera 06h do dia seguinte, 14h e 22h, sem doses anteriores ao início.
- A caixa pode exibir ontem, hoje, amanhã e uma data escolhida. As datas seguem o calendário local do dispositivo, evitando a troca antecipada de dia causada por UTC.
- “Tomar”, “Pular” e “Adiar 15 min” preservam o horário original no histórico. Adiar usa o maior valor entre agora e o horário já previsto; pode atravessar a meia-noite.
- Uma dose finalizada não pode ser finalizada novamente. O estoque cai uma vez por dose, inclusive em tentativas repetidas de sincronização. Cada dose representa uma unidade de estoque; esta versão não calcula consumo em mL ou frações.
- Áudio é ativado por interação e usa um único contexto, sem criar contextos ilimitados.
- O service worker guarda apenas os arquivos da interface. Os registros ficam no LocalStorage, separados por família e projeto Firebase. A fila local tenta sincronizar quando a conexão volta e o app está aberto.
- Valores digitados são escapados antes de entrar no HTML. Exclusão exige confirmação e conserva o histórico. Campos têm rótulos, foco visível, suporte a zoom e modais acessíveis por teclado.
- Os registros do protótipo são copiados uma vez para o novo formato, mantendo as chaves originais. Horários fixos antigos não recebem uma data inicial inventada. A versão original do HTML está preservada em `legacy/curasafe_original.html.txt` e no histórico Git.

## Lembretes: limite real desta versão

O app verifica doses pendentes a cada 10 segundos **enquanto o navegador permite executar a página**. Um service worker não permanece rodando indefinidamente e não transforma esse temporizador em um alarme garantido com a tela bloqueada. `requireInteraction` e a vibração são pedidos ao sistema, que pode não atendê-los.

Para receber avisos com o app fechado, será necessário implementar envio de Web Push por um servidor ou adotar uma solução nativa de alarmes. Mesmo Web Push depende de conexão e condições do sistema; não é garantia de horário exato. Esta versão não implementa esse servidor. Ao voltar ao app, a checagem retoma, incluindo adiamentos do dia anterior. Por enquanto, use o alarme do celular como lembrete principal.

Referência: [MDN — operação offline e em segundo plano](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation).

## Configurar Firebase e Medfriend

1. Criar um aplicativo Web no seu projeto Firebase e habilitar **Authentication → Sign-in method → Anonymous**.
2. Criar o Firestore e publicar as regras de `firestore.rules`. Não usar regras abertas a todos.
3. Em ⚙️ no CuraSafe, colar a configuração Web como JSON, com `apiKey`, `projectId`, `appId` e `authDomain`. Não fornecer chave privada de conta de serviço. A configuração fica neste navegador, não no repositório.
4. Usar o mesmo projeto nos outros aparelhos. A interface mostrará “Nuvem sincronizada” somente após conectar e enviar as operações pendentes.
5. No aparelho do cuidador, copiar o **ID deste dispositivo** exibido em Família. No aparelho titular, colar esse ID em **Autorizar cuidador**. O cuidador então informa o código `CURA_...` do titular.

O titular pode alterar a caixa; cuidadores autorizados podem acompanhar por leitura. A autorização é aplicada nas regras do Firestore, não apenas na interface. O código da família, sozinho, não concede acesso a medicamentos e histórico. As coleções ficam em `families/{familyId}/meds`, `logs` e `members`.

A autenticação anônima identifica este navegador. Limpar seus dados pode perder o acesso de titular; esta versão ainda não oferece recuperação de conta ou backup exportável. Revogar acesso impede novas leituras na nuvem, mas não apaga cópias já vistas e salvas no aparelho do cuidador. Dados locais não são criptografados pelo aplicativo. Coleções antigas do protótipo em `artifacts/...` não são migradas automaticamente; somente os dados locais são copiados.

Referências: [autenticação anônima](https://firebase.google.com/docs/auth/web/anonymous-auth), [regras de acesso](https://firebase.google.com/docs/firestore/security/rules-conditions), [transações](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Desenvolvimento e verificação

Requer Node.js. Os estilos compilados já estão no repositório. Para modificar o visual, executar `npm ci` e `npm run build`; para verificar a lógica, executar `npm test`.

Os testes automáticos cobrem agenda, estoque, migração de histórico, transações e cache offline. Os testes de nuvem usam um Firebase simulado: não substituem a validação de regras no emulador nem o teste em um projeto real. Não há credenciais Firebase neste repositório.

No navegador foram conferidos cadastro, dados incompletos, cores e formatos, dose tomada, adiamento, dose pulada, navegação por datas, histórico após exclusão, persistência após recarregar, configuração JSON inválida e uso com o servidor local desligado. Também foram verificadas larguras de celular, tablet e computador. A execução com Android bloqueado e a sincronização entre aparelhos reais continuam pendentes.

`npm audit --omit=dev` não encontrou vulnerabilidades de dependências de produção. A ferramenta de compilação Tailwind 3 tem alertas em dependências de desenvolvimento; ela processa somente os arquivos do projeto e não roda no app publicado. A migração para Tailwind 4 exige revisão de compatibilidade de navegadores e fica fora desta correção para preservar o visual e a compatibilidade do protótipo.
