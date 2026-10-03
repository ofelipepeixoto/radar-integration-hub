# Consulta CRM interna com n8n

Este workflow autoral consulta o servidor autenticado somente leitura já existente no Hub. A saída contém apenas contagens por etapa, com indicação explícita de amostra. Não publica conteúdo, envia mensagens, cria negócios ou chama um provedor de IA.

**Estado:** JSON preparado para importação; contrato HTTP local e JavaScript dos nós testados. Não foi importado ou executado em uma instalação n8n nesta sessão. O serviço usa dados fictícios por padrão; o workflow não configura OAuth, Nango ou CRM real.

## Arquivos

- `workflows/n8n/crm-preview-internal.json`: export para importar no n8n, com `active: false`, sem credenciais e sem dados fixados em `pinData`.
- `src/n8n-workflow.mjs`: gerador autoral e validação de resposta agregada.
- `scripts/export-n8n.mjs`: regenera o JSON sem abrir conexões ou alterar configurações do n8n.
- `test/n8n-workflow.test.mjs`: regressões do contrato, testes do JavaScript exportado e chamada HTTP ao serviço real do Hub com fixture fictícia.

## Fluxo e fronteira de confiança

1. **Iniciar consulta local:** acionamento manual, sem webhook público ou agenda.
2. **Preparar consulta:** usa apenas o ID interno da execução n8n para produzir `requestId` de até 64 caracteres. Ignora dados de entrada, identidade, ação e URL fornecidos por usuários.
3. **Consultar Hub interno:** POST fixo em `http://127.0.0.1:8787/v1/crm/deals/preview`, corpo contendo somente `requestId`. O POST consulta dados; a ação CRM real permitida continua GET. Tenant, binding, cota e ação são definidos pelo servidor.
4. **Validar e exibir evidência:** recusa ação/scope/contagens fora do contrato, campos inesperados e somas inconsistentes; projeta apenas a amostra e o ID de correlação. Identificadores de tenant, credenciais e resposta bruta não aparecem no último nó.

O nó HTTP não tenta novamente automaticamente, não segue redirects, não aceita status de erro como sucesso e tem timeout de 6 segundos. O workflow possui timeout total de 15 segundos. A mesma execução produz a mesma chave de reserva; replay é recusado pelo ledger local do Hub no mesmo dia UTC. Esse ledger permanece por diretório e não é banco distribuído ou garantia de idempotência permanente.

A projeção do último nó não elimina o histórico intermediário: o nó HTTP recebe `tenantId`, e essa resposta pode ser armazenada pelo histórico de execuções n8n. No piloto, o operador deve definir acesso e retenção desse histórico. A credencial permanece no armazenamento de credenciais n8n, sem exportar seu valor junto do workflow.

## Preparar um piloto privado

O Hub requer Node 22.13 ou superior. A instalação n8n deve seguir os requisitos da sua própria versão e oferecer Manual Trigger v1, Code v2 e HTTP Request v4.4; o snapshot n8n auditado exige Node 24 ou superior. O JSON usa apenas esses nós padrão; não exige community nodes, Python, Execute Command ou pacotes adicionais.

1. No backend local, configure `RADAR_SERVICE_TOKEN` seguindo a documentação do serviço. O servidor exige um token forte de 43–128 caracteres base64url. Não use token de exemplo ou inclua o segredo em Git, workflow, URL ou prompt.
2. Na raiz do Hub, execute `npm run serve:readonly` sem `--live` para usar a fixture fictícia. Não é preciso configurar variáveis Nango. O ledger fica em `.state/`, já ignorado pelo Git.
3. Importe `workflows/n8n/crm-preview-internal.json` em uma instância privada do operador. O export permanece inativo e manual.
4. No nó **Consultar Hub interno**, selecione uma credencial **Header Auth** armazenada no n8n: nome do header `Authorization`, valor `Bearer <o token do serviço>`. Nenhuma credencial vem no export. Configure o segredo somente no armazenamento de credenciais da instância.
5. Execute manualmente uma vez e confira três negócios fictícios: `appointmentscheduled: 1`, `qualifiedtobuy: 2`, `scope: sample-only`. O limite de dez tentativas diárias do tenant inclui outras consultas pelo mesmo ledger.

**Rede local:** `127.0.0.1` pertence ao processo/container n8n. O Hub deve estar no mesmo namespace de rede desse processo para esse endpoint funcionar. Dois containers separados em uma rede Docker comum não compartilham loopback; não substituir por host externo, publicar porta ou ampliar bind do Hub por conveniência. Não foi configurada nenhuma topologia/container nesta implementação.

Se a instância bloqueia destinos loopback pela política SSRF, o operador deverá decidir se autoriza este destino num ambiente isolado. Permitir um IP abre acesso a outros serviços/portas nesse IP; não desative globalmente a proteção nem libere uma faixa privada ampla. Nenhuma política n8n foi alterada automaticamente.

O export não transforma o n8n em fronteira de autorização do CRM. Um autor com permissão de editar workflows pode criar outros fluxos ou modificar código/URL. Restrinja a autoria ao operador confiável e mantenha o token/cota/autorização no Hub. Não compartilhar credenciais com editores de clientes.

## Regenerar e verificar

```bash
node scripts/export-n8n.mjs
node --test test/n8n-workflow.test.mjs
npm test
```

Não é necessária instalação npm: os testes usam a biblioteca padrão do Node. O teste HTTP abre apenas loopback numa porta efêmera, gera token temporário em memória, consulta a fixture existente e apaga o diretório temporário. Ele confirma autenticação, identidade de servidor, replay e reserva de cota. Não chama Nango, OAuth, HubSpot, LLM ou n8n.

O teste de JavaScript executa o conteúdo exato dos nós Code em um contexto Node VM com APIs n8n simuladas. Isso prova o contrato dessas funções, sem provar importação, seleção da credencial, sandbox Code ou execução real da plataforma. Antes de considerar homologado, executar o workflow em uma instância n8n privada, conferir erro de credencial ausente, sucesso fictício, replay 409 e cota 429.

## Schema e origem

Implementação original Carlos Felipe / Radar, MIT; nenhum código upstream n8n foi copiado. Schema conferido no snapshot upstream `944afe5c889f130ac07c1831dd88fa7c7103a5c1`:

- [ManualTrigger v1](https://github.com/n8n-io/n8n/blob/944afe5c889f130ac07c1831dd88fa7c7103a5c1/packages/nodes-base/nodes/ManualTrigger/ManualTrigger.node.ts).
- [Code v2 e parâmetros](https://github.com/n8n-io/n8n/blob/944afe5c889f130ac07c1831dd88fa7c7103a5c1/packages/nodes-base/nodes/Code/Code.node.ts).
- [HTTP Request versões suportadas](https://github.com/n8n-io/n8n/blob/944afe5c889f130ac07c1831dd88fa7c7103a5c1/packages/nodes-base/nodes/HttpRequest/HttpRequest.node.ts).
- [HTTP Request parâmetros](https://github.com/n8n-io/n8n/blob/944afe5c889f130ac07c1831dd88fa7c7103a5c1/packages/nodes-base/nodes/HttpRequest/V3/Description.ts).
- [Execução HTTP, redirects e timeout](https://github.com/n8n-io/n8n/blob/944afe5c889f130ac07c1831dd88fa7c7103a5c1/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts).

A MIT dos arquivos autorais não altera a [licença do n8n](https://github.com/n8n-io/n8n/blob/944afe5c889f130ac07c1831dd88fa7c7103a5c1/LICENSE.md). Este fluxo é para operação interna; não constitui autorização para revender uma instância n8n ou oferecer sua plataforma a terceiros. A licença Nango e a autoria da integração OpenClaw continuam documentadas no NOTICE e nos documentos existentes.
