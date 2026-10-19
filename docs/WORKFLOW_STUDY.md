# Estudo de workflows — decisão B

Implementação original Radar, autorizada em 2026-10-06 após estudar Deer Workflow
(`deerwork-ai/deer-workflow`, commit `b20823012eeec15d41f4969f09964401e00f56e0`).
Não importa código ou dependências Deer; não cria outro runtime ou repositório.

## Contrato executável

`runStudyPlan` aceita exclusivamente este formato:

```json
{"schemaVersion":1,"action":"radar.fixture.batch","concurrency":2,"cases":["success","null","failure"]}
```

Até 20 casos, concorrência inteira entre 1 e 4. Somente três fixtures fixas são
aceitas. Campos adicionais, código, caminhos, ambiente e ações desconhecidas
são rejeitados antes da execução. Plano é copiado e congelado antes de aguardar.
Resultado `STUDY_ONLY`: sucesso com valor, sucesso `null` e erro fixo `TASK_FAILED`
são distintos. A falha da fixture é intencional; não é incidente operacional.

`workflow-controls.mjs` oferece agendamento preguiçoso de tarefas confiáveis e
projeção de eventos por lista permitida. Eventos não carregam mensagens, argumentos,
caminhos, identificadores livres, stacks ou metadados. Escrita síncrona/assíncrona
é aguardada; falha do destino interrompe com `AUDIT_SINK_UNAVAILABLE`.
Cancelamento impede início das tarefas na fila, mas aguarda as já iniciadas.

O utilitário genérico `boundedMap` não limita o tamanho do retorno do callback.
Somente callbacks confiáveis devem usá-lo; o contrato de estudo usa retornos fixos.
Estes controles NÃO isolam processos, interrompem código preso, limitam CPU/memória,
reservam orçamento nem recuperam trabalhos após reinício. Não há provedor pago,
rede ou efeitos externos no estudo. Não usar sucesso da simulação como homologação.

## Integração

- Hub: fonte canônica dos controles, contrato e exportador n8n.
- Control Plane: adapter local registra avaliação `fixture` no catálogo existente,
  vinculada ao plano e artefato; a regra existente exige `live-contract` para publicar.
- n8n: cópia verificável do JSON e fontes fixadas, gatilho manual, inativo.
  Não depende da PR #3 do WhatsApp e não altera os workflows 04–06.

## Reproduzir e testar

`npm test` e `node scripts/export-workflow-study.mjs`.
O segundo comando regenera `workflows/n8n/workflow-study.json`.
Importar como novo workflow no n8n; manter inativo e executar manualmente.
Saída: três resultados, dois eventos sanitizados, `STUDY_ONLY`, indicadores de
pagamento, efeitos externos, isolamento e recuperação persistente em `false`.
Não há credenciais a selecionar. Não há deduplicação persistente: repetir apenas
repete fixtures, sem envio. Importação e execução na instância não homologadas.
Code v2/Manual Trigger v1 seguem os nós já usados pelo Hub; JavaScript assíncrono
é documentado em https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/.

## Evolução e reversão

Antes de qualquer worker real: comprovar necessidade, catálogo de ações fechado,
identidade no backend, isolamento sem privilégios do host, limites CPU/memória/tempo,
reserva persistente de orçamento, outbox/recuperação de resultado desconhecido e
homologação de falhas. Não expor `execute(path, source, env)`.
Reverter esta PR remove somente componentes de estudo. Nenhum deploy ou migração
é necessário. As auditorias e o controle existente do Hub permanecem separados;
o writer deste estudo não substitui os logs de todos os serviços.
