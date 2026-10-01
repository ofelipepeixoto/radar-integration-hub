# Radar Integration Hub

Laboratório autoral de integrações governadas para o ecossistema Radar. Primeira hipótese: consultar uma amostra do funil CRM do Camaleão Growth com OAuth administrado pelo Nango e políticas controladas pelo backend.

**Status:** laboratório local; demonstração com dados fictícios. O adaptador REST para Nango Cloud foi testado com transporte simulado, sem conta, OAuth ou CRM reais. Não há implantação em produção.

## Executar

Requer Node.js 22 ou superior. Sem dependências npm externas, instalação ou chave de API para a demonstração.

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
| Escritas | Bloqueadas; não existe mecanismo de aprovação para liberá-las nesta versão |

A CLI é usada por um operador local e não autentica usuários remotos. O parâmetro `authenticatedTenantId` só é seguro quando uma futura API o obtiver de uma sessão verificada; nunca deve vir do corpo enviado pelo cliente ou de um LLM. Não há servidor HTTP ou MCP nesta versão.

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

Repositório independente, com código original Radar e licença MIT para estes arquivos. Não inclui nem redistribui o núcleo do Nango. Nango é um componente externo de Nango Inc, avaliado no commit `7e61a4c97b5a638bcf01808016099de2fe2f9985`, sob **Elastic License 2.0**. A MIT deste projeto não altera a licença do Nango. Veja [NOTICE](NOTICE.md).
