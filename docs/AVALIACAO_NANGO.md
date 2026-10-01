# Avaliação do Nango para o ecossistema Radar

Data: 01/10/2026. Revisão técnica e decisão de produto, não certificação de segurança.

## Parecer

**Aprovar laboratório de integração; adiar produção até validar identidade, edição, custos e operação.** O melhor encaixe é gerir OAuth de contas de clientes para consultar CRM ou documentos. Para poucas contas internas já atendidas por n8n, a dependência adicional pode não compensar.

Não recomendo transformar uma cópia do Nango em produto de integração gerenciada com marca própria sem verificar os direitos necessários. O projeto publicado é uma camada original de políticas e consultas, que usa o Nango como componente externo identificado.

| Dimensão | Avaliação | Implicação |
|---|---|---|
| Segurança | Boas primitivas; configuração e limites de autorização são determinantes | Não publicar o Compose de exemplo diretamente na VPS |
| Escalabilidade | Plataforma completa tem fila persistente, leases e controle de concorrência | Validar edição e operação antes de planejar workers distribuídos |
| Inovação | OAuth, proxy e integrações revisáveis reduzem trabalho repetido | Diferencial Radar deve ser o resultado entregue e a governança por cliente |
| Desempenho | Arquitetura tem mecanismos úteis; capacidade real não foi medida | Medir latência, 429, memória e custo no piloto |

## Escopo e evidência

- Código público: `NangoHQ/nango`, branch `master`, commit **`7e61a4c97b5a638bcf01808016099de2fe2f9985`**, mensagem `feat(webhooks): add allow unverified webhooks integration option (NAN-7312) (#7726)`.
- Versão declarada no package.json: **0.71.11**; monorepo TypeScript/Node, npm workspaces, Node >=20. Versão do arquivo não prova versão da imagem ou do serviço Cloud.
- Leitura dos módulos de autenticação, criptografia, proxy/egress, rate limiting, scheduler, configuração Docker, licença e segurança.
- `npm audit --omit=dev --json` sobre o lockfile do commit: **7 nós de dependências moderados; nenhum alto/crítico nesse scanner**. Sem correções automáticas aplicadas.
- **64 testes de criptografia do upstream passaram**, executados com os dois arquivos originais em diretório temporário isolado e Vitest 4.1.11. Não foi executada a suíte completa do Nango.
- **31 testes do laboratório original passaram**, incluindo políticas, persistência, concorrência do ledger e contrato REST simulado. Demonstração com três negócios fictícios.

Não houve pentest, carga do servidor, análise de imagem/OS, credenciais reais, OAuth real ou implantação. Nenhum projeto existente foi modificado. As integrações abaixo são propostas com base no contexto dos projetos, não inspeções de cada implementação atual.

## Segurança: pontos favoráveis e condições

**Credenciais:** AES-256-GCM, IV aleatório e autenticação do ciphertext; chave decodificada de 32 bytes. O gerenciamento de chaves/KMS está separado em módulos. Os testes cobrem adulteração, chaves incorretas e compatibilidade de caminhos síncronos/assíncronos. Isso é evidência do módulo, não garantia sobre configuração ou isolamento de toda a instalação.

**Sessões:** cookies httpOnly e secure quando a URL base é HTTPS; persistência de sessões e verificação de senha. Existe fallback de segredo de sessão no código. Definir segredo forte e HTTPS é requisito antes de exposição pública. O comportamento de autenticação varia conforme flags/modo; não desligar flags por tentativa e erro.

**Saída de rede:** políticas e agentes com proteção de resolução DNS; redirecionamentos OAuth restringem encaminhamento de cabeçalhos. OAuth e proxy não têm necessariamente as mesmas exceções para redes privadas. Manter allowlists específicas e revisar a configuração de egress de cada implantação.

**Webhooks:** o commit analisado introduz opção para aceitar webhooks não verificados. O campo semeado começa em `false`. Manter a verificação e testar assinatura, replay e idempotência caso webhooks entrem no produto; essa opção não é prova de falha explorável.

**Autorização:** conexão OAuth válida não autoriza qualquer ação de um agente. Tenant, conexão, endpoint, método, escopo e aprovação devem ser decididos no backend. RBAC do dashboard não limita automaticamente uma chave da API. O laboratório separa binding confiável de entrada solicitada, mas a CLI não fornece autenticação remota.

### Prioridades antes de produção

As prioridades abaixo são requisitos de engenharia, não classificação CVSS de novas vulnerabilidades.

| Prioridade | Observação | Tratamento |
|---|---|---|
| P0 | Exemplo Docker publica Postgres, Redis e aplicação sem binding local; credenciais de DB de exemplo são `nango` | Rede privada, autenticação, segredos distintos, firewall e dashboard restrito |
| P0 | Chave de API tem poder superior ao catálogo de ações exposto ao usuário | Chaves só no backend, tenant obtido de sessão verificada, bindings por cliente e ações permitidas explícitas |
| P0 | Secrets e restauração não foram exercitados | Chave de criptografia antes de armazenar tokens, cópia protegida e teste de restauração/revogação |
| P1 | Tag `hosted` é mutável e Compose não estabelece limites de recursos | Fixar imagem/digest, revisar dependências/OS, limitar CPU/memória e planejar reversão |
| P1 | CSP começa em modo report-only | Testar política efetiva antes de habilitar bloqueio; report-only não bloqueia conteúdo |
| P1 | Rate limiter usa Redis ou memória; erro inesperado do limiter permite continuar a requisição | Cota independente e persistente no gateway, alarmes e teste de indisponibilidade de Redis |
| P1 | Um advisory de uuid aparece em sete nós vulneráveis | Atualizar cadeia compatível e testar funções atingidas; não usar `audit fix --force` sem revisão |
| P1 | Dados obtidos de APIs podem carregar instruções maliciosas | Tratar como dados não confiáveis; jamais permitir mudança de política ou vazamento de chaves pelo conteúdo |

Para credenciais e banco, o isolamento precisa existir também na infraestrutura e nos backups. Recursos de segurança da oferta Cloud não são herdados automaticamente por um laboratório ou self-host.

### Dependências

O scanner identifica `uuid` e a cadeia `botbuilder`, `botbuilder-core`, `botframework-connector`, `botframework-schema`, `botframework-streaming`, `@azure/msal-node`. Os sete registros não são sete vulnerabilidades independentes.

O advisory do mantenedor **GHSA-w5hq-g745-h8pq / CVE-2026-41907** descreve escrita fora dos limites de buffer em funções v3/v5/v6. A aplicabilidade depende da função, versão e de entradas controláveis; não demonstramos um caminho explorável no Nango. O mantenedor registra correções em 11.1.1, 12.0.1 e 13.0.1. A sugestão automática do scanner para a cadeia pode alterar versões importantes; é necessário revisar compatibilidade em vez de forçar.

Arquivo com metadados e alertas: [AUDITORIA_NANGO.json](AUDITORIA_NANGO.json). Resultado temporal: pode mudar conforme a base de advisories e novos commits.

## Escalabilidade

Na plataforma completa, tarefas persistem em Postgres. O scheduler usa locks com `FOR UPDATE SKIP LOCKED`, estados, heartbeats, tentativas e limites de concorrência por grupo. Isso permite vários consumidores sem reivindicar a mesma linha simultaneamente. Não garante efeito externo exatamente uma vez: um retry após resposta perdida pode duplicar uma escrita sem chave idempotente.

Separar aplicação, workers, banco e caches permite crescer, mas inclui operação de fila, conexões, índices, backpressure e retenção de logs. O Dockerfile da edição gratuita remove os pacotes `jobs`, `runner` e `persist`; não planejar a oferta gratuita como se fornecesse toda essa arquitetura.

Não usar o ledger local do laboratório entre réplicas. Para escalar a camada Radar: transação com reserva atômica de cota, chave única `(tenant, requestId)`, prazo de execução, recuperação de tarefas e resultado associado. Persistir escopo e versão da política usada; pausar cliente/provedor quando exceder limites.

## Desempenho

O proxy acrescenta um salto de rede. Rate limits, paginação e tempo da API de origem tendem a dominar consultas reais; autenticação repetida, conexão do banco e retenção também precisam de medição. Não há resultado local que sustente throughput, SLA ou redução percentual de latência do Nango.

O laboratório limita uma página de 10 registros, 64 KiB e 5 segundos. Falhas de transporte/429 não geram retries automáticos. Isso torna custo e exposição mais previsíveis, mas não produz uma análise completa do CRM. Não usar o tempo de testes com mocks como benchmark de produção.

Antes de ampliar: medir latência p50/p95, taxas de 429/timeout, chamadas por resultado útil, bytes, renovação de token, fila, conexões de banco e recursos do processo. Ensaiar falha de Redis e revogação. Se necessário, cache por tenant com TTL e remoção na revogação; nunca compartilhar respostas entre clientes.

## Edição e licença

Nango usa **Elastic License 2.0**, não MIT. Ela permite uso/modificação/distribuição com condições e restringe a oferta a terceiros como serviço hospedado/gerenciado de funcionalidades substanciais. Também proíbe contornar chaves de licença e remover avisos. Um repositório sem a relação de fork continua sujeito à licença do código copiado.

Isso não significa que todo uso comercial ou toda aplicação que dependa do Nango esteja proibida. O limite depende do que o produto entrega aos terceiros. Confirmar com o fornecedor o modelo comercial caso ele exponha funcionalidades substanciais do Nango. Não presumir licença Enterprise nem reclassificar o núcleo como MIT.

| Oferta | Adequação |
|---|---|
| Hospedagem própria gratuita | Auth e Proxy; sem syncs, tools, webhooks, MCP nativo, RBAC ou MFA da plataforma completa |
| Nango Cloud | Plataforma conforme plano e limites contratados; laboratório opcional usa contrato de Proxy |
| Enterprise self-host/BYOC | Plataforma completa; licença e condições comerciais a confirmar |

A documentação alerta que o dashboard gratuito começa aberto e requer configuração de acesso, e que sua chave de criptografia não pode ser alterada após definida. Não usar pooler de Postgres em modo transação. Um banco dedicado com conexão compatível é preferível a reutilizar migrações de projetos existentes.

Preço observado em 01/10/2026: Cloud gratuito com limites mensais; Pay-as-you-go de **US$50/mês, incluindo US$50 de créditos**. A página mostra US$0,29/conexão, US$0,72/hora de execução e US$0,50/GB. Enterprise é sob consulta. Não confundir créditos com franquia ilimitada. Nenhuma assinatura foi ativada e o orçamento financeiro do piloto ainda não foi aprovado.

## Integrações com os projetos

Prioridade indica proposta de encaixe, não conexão já implantada.

| Projeto | Integração proposta | Prioridade e condição |
|---|---|---|
| Camaleão Growth | OAuth de CRM dos clientes; amostra do funil com leitura mínima | **Primeiro piloto**. Validar CRM/provedor realmente utilizado e contexto autenticado |
| Assistente documental IA | Drive/SharePoint por cliente para ingestão autorizada | Alta se houver necessidade real; manter ACLs por documento na busca/RAG, revogação e exclusão |
| Radar OaaS | Fontes privadas dos clientes para relatórios e indicadores | Média; governança e cálculo determinístico no produto Radar |
| LibreChat | Interface para ferramentas curadas via gateway autenticado | Média; não expor proxy genérico ou chave Nango. MCP próprio é trabalho futuro |
| n8n | Orquestra workflows enquanto Nango administra OAuth de várias contas | Complementar; manter credenciais nativas para poucos fluxos internos quando suficientes |
| Radar Disruptivo | Contas autenticadas de backoffice/editorial | Baixa no núcleo de notícias públicas; feeds públicos não exigem OAuth Nango |
| Hermes / projetos locais | Integrações autenticadas específicas após prova de necessidade | Isolamento na VPS, sem ampliar ações financeiras ou de publicação automaticamente |
| Radar de Teses e Riscos / TradingAgents | Fontes autenticadas opcionais | Baixa; não habilitar negociação nem remover revisão humana |
| Radar Video Studio / MoneyPrinterTurbo | Futuro vínculo com contas de distribuição | Nango não gera vídeo; publicação real exige política e aprovação específicas |

Não foram acessadas contas de clientes nem alterados servidores, bancos, fluxos n8n ou outros repositórios para implementar essa matriz.

## Inovação e estratégia de produto

O valor do Nango é retirar complexidade recorrente de autenticação e integração. Seu catálogo e geração assistida de funções não constituem, por si, vantagem exclusiva do Radar. A inovação defendível está em entregar um diagnóstico confiável, com fontes autorizadas, escopo verificável, intervenção humana adequada e custo conhecido.

Começar com uma pergunta: **o responsável consegue revisar uma amostra do funil do cliente sem receber tokens ou copiar dados manualmente?** A versão atual prova políticas locais e formato; ainda não prova economia de tempo nem disposição a pagar. Não adicionar LLM para resolver OAuth, autorização ou orçamento: essas decisões devem ser determinísticas.

## Fontes primárias

Código fixado em https://github.com/NangoHQ/nango/tree/7e61a4c97b5a638bcf01808016099de2fe2f9985:

- `LICENSE`, `LICENSE_SHORT`, `package.json`, `package-lock.json`, `SECURITY.md`, `docker-compose.yaml`, `Dockerfile.self_hosted`.
- `packages/utils/lib/encryption.ts`, `encryption.unit.test.ts`, `environment/detection.ts`.
- `packages/server/lib/clients/auth.client.ts`, `middleware/security.ts`, `middleware/ratelimit.middleware.ts`.
- `packages/shared/lib/utils/encryption.manager.ts`, `services/proxy/outbound-policy.ts`.
- `packages/scheduler/lib/models/tasks.ts`, `packages/node-client/lib/index.ts`.
- [Licença Nango no commit analisado](https://github.com/NangoHQ/nango/blob/7e61a4c97b5a638bcf01808016099de2fe2f9985/LICENSE).
- [FAQ oficial da ELv2](https://www.elastic.co/licensing/elastic-license/faq).
- [Hospedagem própria gratuita](https://nango.dev/docs/guides/platform/free-self-hosting).
- [Hospedagem Enterprise](https://nango.dev/docs/guides/platform/self-hosting/self-hosting).
- [Segurança](https://nango.dev/docs/guides/platform/security).
- [Contrato Proxy GET](https://nango.dev/docs/reference/backend/http-api/proxy/get).
- [Preço](https://nango.dev/pricing/).
- [Advisory do mantenedor uuid](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).

Documentação e preço são referências observadas na data da análise e podem mudar.
