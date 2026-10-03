# Aprovação e orçamento: laboratório persistente

`src/governance.mjs` é código original Carlos Felipe/Radar, MIT. Implementa contratos locais para propostas e orçamento futuro. Não contém executor de publicação, LLM, escrita CRM ou autenticação de pessoas. Nenhuma rota HTTP, ferramenta OpenClaw/JSONL ou workflow n8n oferece estes métodos.

## Fronteira de identidade

O consumidor backend deve fornecer `createPrincipalResolver(authenticate)`. Essa função de autenticação precisa verificar sessão/token, emissor, validade, associação ao tenant e papéis numa fonte confiável. O resolver valida o formato e cria um objeto de contexto reconhecido pela biblioteca, que não pode ser fabricado apenas enviando JSON. **O resolver não verifica um provedor de identidade por conta própria.** Os testes usam um autenticador sintético, identificado como fixture; não comprovam pessoas reais, login Supabase ou MFA.

`human-session` é uma afirmação do autenticador confiável sobre a sessão, não uma prova fornecida pelo cliente. Um token de serviço continua `service` e não pode aprovar. O subject deve ser pseudônimo estável, único no namespace do autenticador e sem credenciais ou email. A sessão dura no máximo uma hora; a aprovação no máximo quinze minutos e nunca ultrapassa o término da sessão revisora. O executor deve obter contexto novamente após reiniciar o processo. Revogação antecipada de sessão/membership ainda precisa ser consultada pelo consumidor antes de executar; não existe sincronização automática com Supabase neste laboratório.

Papéis: `submitter`, `reviewer`, `executor`, `auditor`. O revisor deve ser diferente do autor. O consumidor só deve emitir os papéis realmente autorizados. Esta biblioteca exige um revisor independente; **não implementa o comitê com duas aprovações do Hermes Leilão** e não deve substituir suas políticas.

## Proposta, revisão e recibo

1. `submit` calcula SHA-256 sobre tenant, ID, versão, ação e JSON canônico limitado a 16 KiB. Persiste hash/metadados; não o corpo da proposta.
2. A interface revisora deve buscar o conteúdo na aplicação de origem, verificar o hash de novo e mostrar a versão exata antes de chamar `approve`. A biblioteca não contém essa interface nem guarda o texto para apresentá-lo.
3. `approve` vincula revisor, hash, versão e expiração. Alterar a versão invalida a aprovação anterior.
4. `consumeApproval` devolve um recibo local e consome a aprovação uma vez. Uma segunda aprovação da mesma versão também não permite consumir duas vezes.
5. O recibo tem escopo `local-approval-receipt-only`; não comprova que uma ação externa foi executada, não autentica o chamador de outra aplicação e não deve ser aceito diretamente do corpo de uma requisição.

As ações fixas são `draft.public-sources.review` e `ai.draft.preview`. A primeira apenas permite consumir uma revisão local. A segunda exige o caminho de reserva, que ainda não tem provedor. URLs, shell, escrita CRM, exclusão de credenciais, envio e publicação não são capacidades desta biblioteca. O consumidor precisa manter sua allowlist própria e verificar identidade, estado e hash na mesma fronteira de execução.

## Reserva financeira futura

Padrão: `paidEnabled: false`, limite de todo tenant igual a **zero**. Não há variável de ambiente que habilite pagamento no serviço HTTP atual.

Para um experimento sintético, o operador pode construir o store com `paidEnabled: true` e `dailyLimitsMicros: { tenant: ... }`. Valores são inteiros em milionésimos de BRL; não usar ponto flutuante ou confundir estas fixtures pequenas com preços reais. A proposta IA precisa trazer `currency: 'BRL'` e `maximumCostMicros`, ambos incluídos no hash aprovado. A reserva nunca pode aumentar esse máximo.

`reservePaid` consome a aprovação e reserva o limite **na mesma transação**, antes de qualquer chamada. Retorna `providerCalled: false`: o módulo nunca chama um provedor. O futuro adapter deve calcular um teto conservador, limitar tokens/iterações/timeout no executor e respeitar o estado persistente:

- `held`: reserva persistida; pode ser cancelada somente antes de iniciar.
- `started`: registrar **antes** de enviar a chamada. Essa fronteira revalida configuração de pagamento, bloqueio do tenant, limite atual, expiração e versão/hash; uma reserva antiga não permite contornar pagamento desabilitado, orçamento reduzido, overrun ou proposta revisada. Um crash/timeout mantém o valor inteiro reservado; não fazer retry automático nem assumir custo zero.
- `settled`: `reconcile` registra custo real obtido pelo backend de uma fonte contábil confiável. Libera apenas a diferença autorizada.
- `overrun`: custo real acima da reserva é registrado, e o tenant fica bloqueado para novas reservas. Não existe desbloqueio automático.
- `cancelled`: libera uma reserva não iniciada; não devolve a aprovação consumida nem torna o ID reutilizável.

O dia é UTC da reserva; custos reconciliados pertencem a esse dia. Reservas incertas de dias anteriores continuam prendendo capacidade nos dias seguintes. Esses controles cobrem somente executores que usam este mesmo store. Não limitam chamadas fora dele, contas do provedor, câmbio, impostos, Nango ou LLM do host OpenClaw. A implementação de contabilidade do provedor e a medição de custos reais são gates pendentes.

## Persistência, concorrência e operação

Node **22.13 ou superior**, sem dependências npm. `node:sqlite` é um módulo experimental nesta linha; não foi instalado outro banco na VPS. [Documentação Node 22.13.1](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html). Para produção no ecossistema existente, homologar uma versão Node ou adaptar estes contratos às transações do PostgreSQL/Supabase já disponível, sem criar outra infraestrutura por conveniência.

O arquivo SQLite deve ficar em diretório privado do operador, normalmente `.state/`, excluído do Git. Diretório acessível a grupo/outros, symlink direto e banco inválido falham fechados. Arquivo usa modo 0600; WAL, `synchronous=FULL`, `BEGIN IMMEDIATE`, constraints únicas e busy timeout de dois segundos protegem transações locais concorrentes. SQL não deriva do corpo da proposta. Erros de armazenamento viram códigos fixos, sem mensagem SQL/caminho/segredo.

Estas garantias exigem um único volume local confiável e permissões adequadas. Não usar SQLite em NFS, volumes duplicados por réplica ou como banco distribuído. Um administrador do host pode alterar o arquivo; não há assinatura, log imutável ou resistência a operador malicioso. Não apagar o store para liberar orçamento. Fazer backup consistente com WAL/transactions e testar restauração antes de operação; backup e retenção ainda não foram homologados.

Eventos persistem junto da transação: tipo fixo, referência, hash do subject e timestamp. São limitados por tenant e papel auditor, com as cem entradas mais recentes por consulta. Hashes são correlação, não anonimização garantida. A aplicação ainda precisa definir retenção, acesso e monitoramento. Negativas de governança são retornadas ao backend; ele deve auditar os códigos fixos sem gravar body/headers.

## Health, readiness e evidência

O HTTP existente continua loopback, tenant fixo e token de serviço. GET autenticado `/healthz` confirma somente processo vivo. GET autenticado `/readyz` falha fechado por padrão; uma checagem confiável pode demonstrar um contrato local pronto, com deadline de 250 ms. A resposta sempre declara `humanIdentityConfigured:false`, `paidCallsEnabled:false` e `providerVerified:false`; sucesso não certifica produção, n8n, OpenClaw, OAuth ou CRM.

Eventos HTTP possuem schema v1, ação/status/código/duração e `requestIdHash`. IDs brutos deixaram de entrar nos logs para impedir que um segredo colado num ID válido apareça em stdout. O operador deve ajustar seus consumidores de logs. Body, header, stack e mensagem arbitrária do provedor não são copiados.

## Verificação executada

```bash
node --test test/governance.test.mjs test/observability.test.mjs
npm test
npm run demo
npm run demo:openclaw
```

Os testes locais cobrem persistência, sessão expirada, objeto de identidade fabricado, serviço impedido de revisar, autoaprovação, cross-tenant, troca de hash/versão, replay entre executores e processos, disputa de orçamento entre quatro processos, cancelamento, reconciliação, overrun, rollback após SIGKILL e HTTP real em loopback com fixture. Nenhum deles chama LLM, Nango, CRM, n8n, Supabase ou authenticator real.

Gates para operação: autenticador confiável e revogação; tela de revisão do conteúdo correto; composição com as aplicações consumidoras; adapter de custos/provedor; volume/backup/restore; CI remoto; topologia e importação n8n; homologação do Gateway; carga e comportamento sob falha. Até lá, biblioteca e HTTP são laboratório.
