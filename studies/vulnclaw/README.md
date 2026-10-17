# Estudo VulnClaw: aprovação vinculada à evidência

Implementação autoral preparada para Carlos Felipe com assistência de IA, MIT.
Decisão **B — STUDY**. Este experimento usa o `GovernanceStore` existente do Hub,
sem importar código, skills ou engine do VulnClaw. Data de execução: 17/10/2026.

## Hipótese e baseline

Se a proposta incluir o digest do conteúdo e a origem da evidência, uma mudança
nesses campos invalida a aprovação anterior quando o consumidor recalcula o hash
da proposta completa. Apenas descrever a operação não distingue dois documentos.

Baseline: Hub [`d7084bdf`](https://github.com/ofelipepeixoto/radar-integration-hub/tree/d7084bdf63fcea9cf13ad1c5b3254c828b2cb6e2),
140 testes existentes aprovados antes da mudança. A comparação usa a mesma função
`proposalHash`, com e sem metadados de evidência; não é uma comparação de modelos
nem uma alegação de defeito no Hub. Nenhum arquivo de `src/` foi alterado.

Referência estudada: [VulnClaw no snapshot auditado](https://github.com/Netw0rkNoob/VulnClaw/tree/0b34878f84b089b21fcf85ecd445315f14df0672),
em particular padrões de aprovação em `vulnclaw/agent/exec_gate.py`. Código upstream
tem sua própria autoria e licença MIT; não foi incorporado a este estudo. O
[fork público](https://github.com/ofelipepeixoto/VulnClaw) conserva essa origem.

O corpo e a origem da evidência são **fixtures sintéticas** (`fixtureId` e revisão
fictícia). O campo `referenceSource` identifica a inspiração técnica, separado da
origem das fixtures. O digest sintético não é o hash de um arquivo upstream.

## Executar e conferir

Node >=22.13; nenhuma dependência adicional ou credencial.

```sh
npm run study:vulnclaw
node --test test/vulnclaw-study.test.mjs
npm test
```

O runner cria um SQLite temporário privado e o remove ao terminar. O resumo JSON
é calculado a cada execução: não há relatório gerado versionado para ficar obsoleto.
A CI existente executa os novos testes automaticamente por `node --test`.

| Cenário | Resultado esperado |
| --- | --- |
| Evidência e proposta mantidas | Um recibo local |
| Conteúdo, origem ou escopo alterados; versão antiga | `PROPOSAL_CHANGED` |
| Modelo fabrica claims de revisor; serviço tenta revisar; tenant diferente | `IDENTITY_DENIED` |
| Autor revisa a própria proposta | `SELF_APPROVAL_DENIED` |
| Nenhuma aprovação humana informada | `INVALID_APPROVAL` |
| Aprovação expirada | `APPROVAL_EXPIRED` |
| Resultado do consumo desconhecido, seguido de reabertura e replay | `APPROVAL_REPLAY` |

São 12 cenários e 16 testes novos. O segundo consumo no cenário incerto é
recusado; o primeiro apenas grava um recibo local, sem ação externa. O resumo
exporta códigos e contagens de tipos de evento, sem corpos, claims, identificadores
de aprovação/recibo ou identidade. Essa projeção por allowlist é própria do estudo,
não um redator genérico de relatórios.

## Limites e conclusão operacional

A governança existente já atende aos controles exercitados. O ganho demonstrado
é incluir evidência na proposta e conferir o hash completo antes de consumir sua
aprovação. O store recebe uma referência: se um futuro adaptador enviar o hash
antigo enquanto executa argumentos novos, este experimento não o protege. O
adaptador precisará recalcular e vincular exatamente os argumentos usados.

As identidades humanas são dublês de teste, não sessões autenticadas. Um digest
registra igualdade de bytes; não prova veracidade, autoria ou revisão da evidência.
Não existem assinatura de recibo, custódia durável do raw, transporte real, scanner,
shell, provider, modelo, custo pago, n8n ativo ou implantação nesta mudança.

O teste de persistência cobre replay de recibo local após reabrir o banco. Não
comprova entrega exatamente uma vez ou reconciliação de uma ação externa. O estudo
Dify existente trata separadamente reservas de custo e resultados incertos.

Aplicação futura: Control Plane autentica e define escopo; Hub recebe a proposta
completa; Evidence Kit pode receber o recibo validado. Esses componentes não foram
conectados entre si nesta PR. Antes disso faltam identidade real, autorização por
recurso, política de raw/retenção e integração ponta a ponta. Redirecionamentos,
dados sensíveis e dependências do VulnClaw continuam no backlog do fork.

Reversão: remover este diretório, `test/vulnclaw-study.test.mjs` e o script npm.
O núcleo, os workflows existentes e os bancos de operação permanecem como estavam.
