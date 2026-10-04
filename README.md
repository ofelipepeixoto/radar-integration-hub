# Radar Integration Hub

Laboratório autoral de integrações governadas para o ecossistema Radar. Primeira hipótese: consultar uma amostra do funil CRM do Camaleão Growth com OAuth administrado pelo Nango e políticas controladas pelo backend.

**Status:** laboratório local; demonstração com dados fictícios. O adaptador REST para Nango Cloud foi testado com transporte simulado, sem conta, OAuth ou CRM reais. O adaptador OpenClaw e o servidor de leitura foram exercitados por HTTP local real, com CRM fictício. O carregamento no Gateway OpenClaw ainda não foi homologado. Não há implantação em produção.

## Executar

Requer Node.js 22.13 ou superior. Sem dependências npm externas, instalação ou chave de API para a demonstração.

```bash
git clone https://github.com/ofelipepeixoto/radar-integration-hub.git
cd radar-integration-hub
npm test
npm run demo
```

A demonstração retorna três negócios fictícios, agregados por etapa. Essa amostra não representa o funil completo nem calcula receita ou ROI.

## Controles implementados

| Controle | Comportamento |
|---|---|
| Ação permitida | Apenas `crm.deals.preview`, método GET e endpoint fixo de negócios HubSpot |
| Vínculo por cliente | Compara contexto autenticado com tenant solicitado antes de acessar binding configurado pelo operador |
| Exposição de dados | Retorna contagens por etapa; descarta IDs, nomes e campos não solicitados |
| Limite persistente | Até 10 tentativas por tenant/dia UTC no mesmo diretório; falhas também contam |
| Duplicatas | Recusa request ID repetido no mesmo dia |
| Rede | Host Nango Cloud fixo, timeout de 5 segundos, sem redirects ou retries automáticos |
| Volume | Até 10 registros e resposta de 64 KiB |
| Falhas | Códigos de erro sem corpo do provedor ou credenciais |
| Escritas | Bloqueadas; os recibos locais de revisão não liberam ações externas |
| Governança futura | Biblioteca local persistente, vinculando proposta/hash/versão/revisor/tenant, sem autenticador ou provedor reais |
| IA paga | Desabilitada por padrão e orçamento zero; reserva/reconciliação sintética testada, sem endpoint de pagamento |
| Health/readiness | Processo vivo separado de prontidão local; nenhuma resposta certifica produção |

A CLI é usada por um operador local e não autentica usuários remotos. O parâmetro `authenticatedTenantId` deve vir de contexto confiável; nunca deve vir do corpo enviado pelo cliente ou de um LLM. O novo servidor HTTP local autentica uma credencial de serviço, vinculada a um único tenant configurado pelo operador. Isso não representa identidade de usuário final nem isolamento SaaS. Não há servidor MCP nesta versão.

## Governança persistente preparada

`src/governance.mjs` oferece revisão com expiração/replay e reserva financeira atômica usando SQLite local, em Node 22.13+. Está isolado do HTTP, n8n, OpenClaw e JSONL: ainda não há autenticador de pessoas, tela de revisão ou chamada paga. Os testes usam identidades e custos sintéticos. Consulte [GOVERNANCE](docs/GOVERNANCE.md) para a fronteira de confiança, gates operacionais e limites do armazenamento; [ADR MCP](docs/ADR_MCP.md) registra por que não foi adicionado outro servidor.

O HTTP ganhou GET autenticado `/healthz` e `/readyz`. Readiness é bloqueada por padrão e tem escopo local. Os logs agora usam `requestIdHash`, em vez de ID bruto, com campos e códigos permitidos. Nenhum teste fez autenticação remota, OAuth, execução n8n ou chamada a um provedor de IA.

O [controle de segredos](.security/README.md) usa Gitleaks fixado, política da base confiável e um resumo sanitizado do histórico alcançável. Fixtures Python ficam em `tests/`; a suíte Node existente permanece em `test/`. O gate remoto e a proteção de branch precisam de bootstrap e verificação próprios.

## Assistente OpenClaw: integração original

O módulo `plugins/openclaw-radar` oferece somente `radar_crm_preview`. A ferramenta não recebe argumentos de tenant, URL, credencial, provedor ou ação. O servidor decide o vínculo e conserva a cota, o bloqueio de duplicatas e a lista de ações permitidas.

```bash
npm run demo:openclaw
```

Essa demonstração inicia um servidor em `127.0.0.1` com token aleatório apenas em memória, chama a implementação da ferramenta e encerra tudo. Usa HTTP real e CRM fictício; não inicia o Gateway nem chama LLM, Nango ou HubSpot. Não exige instalação do OpenClaw.

Para configuração e homologação no Gateway, consulte [docs/OPENCLAW.md](docs/OPENCLAW.md). O SDK é experimental; a versão de referência é `2026.9.7`, ainda pendente de teste de carregamento. Tokens de serviço ficam no processo, fora de prompts e schemas. O token de operador do Gateway não é usado para autenticar o Hub.

## Bridge local para outros runtimes internos

O adapter original `src/runtime-cli.mjs` reutiliza a ferramenta e o servidor local existentes por JSON Lines. Aceita apenas `radar_crm_preview` e argumentos vazios; tenant e vínculo continuam no serviço configurado pelo operador. Há limites de entrada, mensagens, timeout e duração da sessão, com replay preservado no ledger. Não adiciona dependências.

```bash
node src/runtime-cli.mjs --describe
node --env-file=.env.runtime-test src/runtime-cli.mjs
```

O segundo comando requer o serviço local e sua credencial limitada. Consulte [docs/RUNTIME_BRIDGE.md](docs/RUNTIME_BRIDGE.md) para preparação sintética, contrato e limites. É um bridge genérico JSONL, não um servidor MCP ou plugin nativo Hermes. O carregamento e a configuração efetiva de ferramentas no host permanecem pendentes de homologação.

## Adaptador opcional para conta de teste

1. Configure no Nango uma integração HubSpot e uma conexão com permissões mínimas de leitura.
2. Use variáveis de ambiente no backend. `.env.example` apenas documenta nomes; não contém valores e não é carregado automaticamente.
3. Depois de definir as variáveis, execute explicitamente:

```bash
node --env-file=.env src/cli.mjs --live
```

Variáveis: `NANGO_SECRET_KEY`, `NANGO_PROVIDER_CONFIG_KEY`, `NANGO_CONNECTION_ID`. O provedor deve ser HubSpot; IDs aceitos pelo laboratório usam somente letras, números, `_` e `-`. A CLI está vinculada ao tenant fictício `camaleao-demo`; outras contas exigem bindings confiáveis no backend. Não coloque chaves em prompts, frontend, logs ou arquivos versionados.

O modo `--live` pode gerar consumo do Nango e do provedor. A cota local limita tentativas deste processo; **não é um teto financeiro da conta Nango** nem cobre outros serviços. Nenhuma chamada real foi feita durante a preparação deste projeto.

## Persistência e limites

O ledger fica em `.state/`, ignorado pelo Git. É uma proteção local por diretório, não distribuída. Um crash durante a reserva pode deixar `lock/`: o operador deve confirmar que nenhum processo está ativo antes de removê-lo. Remover `.state/` perde a cota e o histórico. Para produção, substituir por transações e restrições únicas em banco, vinculadas à identidade autenticada, com trilha de auditoria, revogação e cotas por conta/provedor.

## Avaliação e evolução

- [Avaliação técnica do Nango](docs/AVALIACAO_NANGO.md): segurança, escala, desempenho, inovação, licença e integração com os projetos Radar.
- [Evidência do scanner](docs/AUDITORIA_NANGO.json): resultados de dependências do upstream fixado.
- [Plano do piloto](docs/PILOTO.md): hipótese, métricas e critérios de avanço.

## Autoria e licença

Repositório independente, de **Carlos Felipe (`ofelipepeixoto`)**, com código original Radar e licença MIT para estes arquivos. Não inclui nem redistribui os núcleos do Nango ou OpenClaw. Nango é componente externo de Nango Inc, sob **Elastic License 2.0**. OpenClaw é componente externo da OpenClaw Foundation, sob **MIT**, avaliado na release `2026.9.7`. A MIT deste projeto não altera direitos sobre dependências, serviços e marcas. Veja [NOTICE](NOTICE.md) e [política de autoria](docs/AUTORIA.md).

## Hermes: primeira integração verificável

Plugin e worker determinístico de leitura governada implementados, sem chamadas de modelo. Testados localmente com registro real do Hermes fixado e HTTP real, usando CRM fictício. [Contrato, instalação e limites](docs/HERMES.md). [Workflow n8n inativo](integrations/n8n/hermes-job.workflow.json). Imagem, VPS e execução real no n8n ainda pendentes de homologação.
