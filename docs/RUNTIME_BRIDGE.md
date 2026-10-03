# Bridge local para runtimes internos

Implementação original Carlos Felipe/Radar. Este adapter acrescenta transporte JSON Lines local ao contrato de leitura já existente no PR OpenClaw. Reutiliza `plugins/openclaw-radar/tool.mjs` e `src/service.mjs`; não cria outro servidor, não duplica bindings e não altera o ledger.

## Fronteira

O bridge é um processo de operador que possui apenas a credencial limitada do serviço local. O servidor HTTP determina o tenant a partir de `RADAR_TENANT_ID`, definido pelo operador no processo do serviço. O stdin nunca recebe tenant, endpoint, token, provedor, binding, shell ou ação. A única ferramenta é `radar_crm_preview`, com argumentos vazios.

`src/runtime-cli.mjs` é um adapter genérico JSONL, **não um servidor MCP nem plugin nativo Hermes**. A integração OpenClaw por SDK continua na pasta `plugins/openclaw-radar`, com homologação no Gateway pendente. O bridge pode ser consumido por um wrapper de ferramentas do host interno que saiba iniciar um subprocesso fixo e trocar JSONL. Este teste não registra automaticamente ferramentas no Hermes, não altera a VPS e não prova o runtime efetivo desses hosts.

O comando e o ambiente do subprocesso devem ser configurados pelo operador fora do prompt. Não permitir que o modelo selecione argumentos de processo ou nome/caminho do executável. Não cadastrar este comando na configuração de MCP como se ele implementasse JSON-RPC/MCP.

## Executar com serviço sintético

Requer Node.js 22+. Não instalar OpenClaw ou Hermes para rodar o bridge. O serviço já suporta fixtures locais e não chama Nango/HubSpot no modo padrão.

1. Configure no processo do serviço um `RADAR_SERVICE_TOKEN` forte, como descrito em [OPENCLAW.md](OPENCLAW.md), e um `RADAR_TENANT_ID` de teste escolhido pelo operador. Guarde valores reais em arquivos ignorados ou gerenciador de segredos, nunca em arquivos versionados.
2. Inicie o serviço sintético em um terminal:

```bash
node --env-file=.env.service-test src/service-cli.mjs
```

3. No arquivo local ignorado `.env.runtime-test`, configure somente `RADAR_SERVICE_TOKEN` (mesmo valor limitado do serviço) e, opcionalmente, `RADAR_HUB_ENDPOINT=http://127.0.0.1:8787/v1/crm/deals/preview`. Não fornecer credencial Nango ao bridge.
4. Em outro terminal, execute:

```bash
node --env-file=.env.runtime-test src/runtime-cli.mjs
```

Envie uma linha JSON pelo stdin:

```json
{"id":"consulta-1","tool":"radar_crm_preview","arguments":{}}
```

Resposta para a fixture existente:

```json
{"id":"consulta-1","ok":true,"result":{"scope":"sample-only","sampleCount":3,"stages":{"appointmentscheduled":1,"qualifiedtobuy":2},"hasMore":false}}
```

A ordem das chaves JSON não é significativa. A amostra não representa o funil completo. O campo tenant fica fora da resposta do bridge e do contexto do modelo. ID é a identidade estável da chamada de ferramenta: reutilizar o mesmo ID em retry/reconexão conserva o hash de reserva do transporte. Não gerar outro ID para contornar replay.

O bridge não aceita `--live`. Somente o operador do serviço pode escolher seu modo existente. Usar o bridge contra um serviço iniciado explicitamente com `--live` pode consumir Nango/CRM; nenhuma chamada externa foi feita durante os testes desta entrega.

## Contrato JSONL

Uma requisição por linha, UTF-8 válido; CRLF é aceito. EOF pode encerrar a última linha. Campos extras no envelope ou em `arguments` são recusados antes da rede. IDs usam 1–64 letras, números, `_` ou `-`.

| Campo | Valor |
|---|---|
| `id` | ID estável da chamada, controlado pelo host |
| `tool` | Somente `radar_crm_preview` |
| `arguments` | Objeto vazio `{}` |

Resposta de sucesso: `{id,ok:true,result:{scope,sampleCount,stages,hasMore}}`. Resposta de erro: `{id,ok:false,error:{code}}`; o ID é `null` quando inválido/não disponível. Erros não incluem token, URL, payload, nomes ou mensagem privada do provedor. stdout contém somente respostas JSONL; startup inválido produz mensagem fixa em stderr e exit 1.

```bash
node src/runtime-cli.mjs --describe
```

Esse comando imprime o schema e os limites padrão sem exigir token e sem abrir conexão.

## Limites

| Limite | Padrão / máximo | Comportamento |
|---|---|---|
| Entrada | 4.096 bytes por linha | Linha excessiva encerra sessão sem executar |
| Mensagens | 10 por processo; operador pode reduzir | JSON/schema inválidos também contam; mensagem seguinte recebe `RUNTIME_CALL_LIMIT` e encerra |
| Tool simultânea | 1 | Segunda chamada concorrente é recusada |
| Timeout da chamada | 6.000 ms; operador pode reduzir até 25 ms | Aborta transporte e sela sessão sem executar novas chamadas |
| Duração da sessão | 60.000 ms; operador pode reduzir até 25 ms | Fecha stdin/processo quando o prazo acaba, inclusive ocioso |
| Cota persistente | Ledger já existente, até 10 tentativas por tenant/dia UTC | Recriar bridge não renova cota nem replay |
| Retry | Nenhum automático | Host recebe erro e conserva o mesmo ID |

Exemplo de limites menores configurados pelo operador:

```bash
node --env-file=.env.runtime-test src/runtime-cli.mjs --max-calls 3 --timeout-ms 3000 --session-timeout-ms 15000
```

Cancelar o fetch local não prova cancelamento da consulta no servidor/CRM. Uma reserva já realizada continua consumida, e uma leitura já iniciada pode finalizar depois do timeout. O bridge não reabre sessão nem faz chamadas posteriores automaticamente. Não habilita escrita. Limites do bridge não limitam gastos do LLM/runtime, de outros clientes ou da conta inteira.

O FileLedger existente usa `mkdir(lock)` para exclusão local e `rename` para publicar a reserva antes da chamada. Não foi substituído por uma implementação menos segura. É por diretório/host, não distribuído, e crash pode deixar lock. Para clientes adversariais/múltiplos hosts, persistência transacional e identidade de usuário continuam trabalhos futuros; não alegar autenticação SaaS.

## Validação realizada e aceite do host

```bash
npm test
node --test test/runtime.test.mjs
node --check src/runtime-bridge.mjs
node --check src/runtime-cli.mjs
npm run demo:openclaw
```

A suíte do bridge testa framing, UTF-8, limite de bytes/mensagens/tempo, concorrência, erros sanitizados e authority spoof. Um subprocesso CLI real conversa por HTTP loopback com serviço real usando CRM fictício; comprova binding de operador, projeção de dados e replay conservado após reiniciar o bridge. Não chama LLM, Nango, HubSpot ou hosts Hermes/OpenClaw.

Antes de usar um host, homologar seu wrapper de subprocesso, propagação de timeout/cancelamento e inventário efetivo de ferramentas. Permitir apenas esta ferramenta no agente de teste e verificar que shell/browser/publicação/mensagens não continuam acessíveis por outra configuração. A existência do bridge não restringe automaticamente todo o host.

Preferir um único runtime interno para o caso de uso; não instalar segundo Hermes ou OpenClaw só para este adapter. Manter `EXPERIMENT` até homologar o host e medir utilidade, custo e qualidade.
