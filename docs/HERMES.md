# Hermes: integração Radar somente leitura — 0.1.0

Componentes originais de Carlos Felipe, MIT. O runtime Hermes continua sendo da Nous Research, MIT; não foi copiado para este repositório. Pin homologado para os imports testados: `c225c4a04e8b517a357804ebb27367b0c961fd0e`.

## O que funciona

- Plugin Python `plugins/hermes-radar/` registra **uma** ferramenta: `radar_crm_preview`, sem parâmetros de autoridade.
- Worker de um job importa `PluginContext`, `PluginManager` e o registry reais do Hermes; registra apenas esse adapter, despacha a consulta e termina. Não instancia AIAgent, não descobre ferramentas builtin nem chama modelos.
- Supervisor Node usa comando fixo sem shell, ambiente mínimo, uma execução concorrente por instância, timeout de 10 s e saída máxima de 16 KiB. Diagnósticos do subprocesso não são repassados. Não há retry automático.
- Servidor `/v1/hermes/preview` só escuta em loopback. Exige credencial interna distinta da credencial usada pelo worker para o Hub. O tenant continua vindo da configuração confiável do Hub.
- Plugin usa segredos resolvidos no escopo Hermes, endpoint loopback fixado no startup, timeout de 6 s, sem proxy/redirect. Retorna só contagens; descarta identidade de tenant, IDs de negócios e nomes.
- Hash do ID de job é chave de reserva no ledger existente do Hub. Replay não faz nova consulta; falhas também consomem tentativa. O resultado não é cacheado: replay é recusado, não recuperado.
- Workflow n8n inativo chama o serviço interno, verifica schema e correlação, e entrega `review-required`. Não publica, não escreve CRM e não aprova ações.

**Limite:** `paidCallsEnabled:false` descreve este worker determinístico, sem implementação de LLM. Instalar só o plugin num Hermes completo **não desabilita suas chamadas de modelo, terminal, plugins ou outras ferramentas**. Nem hook observador nem exceção de middleware constituem barreira externa. Antes de acrescentar LLM, implementar reserva/reconciliação de cada tentativa física e auxiliares, e bloqueio externo efetivo.

## Contrato

Entrada máxima 4 KiB, um objeto e nenhum campo adicional:

```json
{"version":"radar.hermes.job.v1","id":"n8n_execution-123","tool":"radar_crm_preview","arguments":{}}
```

ID: 1–64 caracteres ASCII alfanuméricos, `_` ou `-`. Versão/tool exatas. Não aceita prompt, tenant, URL, credencial, código ou habilitação paga. Python recusa chaves JSON duplicadas; o serviço Node interpreta JSON antes de serializar o job estrito. Tratar o caller do serviço como interno e confiável, não oferecer essa credencial a clientes.

Sucesso é agregado amostral, não receita, completude do funil ou informação aprovada para publicação. Falha/timeout do subprocesso não garante que a consulta deixou de acontecer. `WORKER_RESULT_UNKNOWN` exige reconciliação pelo operador; não repetir cegamente.

## Executar localmente em staging

Pré-requisitos: Hub read-only preparado com sua configuração protegida; checkout íntegro Hermes no pin; ambiente criado pelo PM upstream, Python 3.14; Node >=22.13. O ambiente deste repositório não instala ou atualiza Hermes.

Configurar fora do Git, por mecanismo protegido do operador:

| Configuração | Origem |
|---|---|
| `RADAR_HERMES_PYTHON` | Caminho absoluto do Python no ambiente Hermes preparado |
| `RADAR_HERMES_SOURCE` | Checkout absoluto no pin, ou imagem auditada |
| `RADAR_HUB_ENDPOINT` | `http://127.0.0.1:8787/v1/crm/deals/preview` no namespace correto |
| `RADAR_SERVICE_TOKEN` | Credencial mínima do serviço Hub; nunca valor no workflow |
| `RADAR_WORKER_SERVICE_TOKEN` | Outra credencial para entrada do worker; nunca reutilizar a anterior |

```sh
node src/hermes-service-cli.mjs
```

Isso inicia um serviço local; não cria daemon, fila durável, isolamento de SO ou deployment na VPS. Binding/tenant/quota vêm do Hub existente. Parar com SIGINT/SIGTERM; o worker é limitado pelo supervisor. Sem backup dos ledgers, reiniciar num diretório novo pode perder limites/idempotência. Não compartilhar estado entre unidades adversariais de confiança.

## Isolamento do processo inteiro

`integrations/hermes/worker.Dockerfile` é um **perfil preparado, ainda não construído/testado**. Requer construir previamente uma imagem local `radar-hermes-audited:local` do checkout upstream íntegro no pin; conferir `git status`, os arquivos de lock e a procedência antes. O derivado não baixa nem instala dependências; roda como usuário hermes e executa apenas nosso worker. O marcador `.radar-upstream-pin` é metadado de build, não assinatura, verificação de toda a árvore ou prova de integridade do runtime.

Homologação obrigatória antes da VPS:

1. Registrar digest da imagem efetivamente construída, conservar locks e obter inventário de dependências.
2. Usar rede interna dedicada. O endpoint atual é loopback: worker deve partilhar o **namespace de um serviço Hub já isolado**, com tenant/binding exclusivo. Não usar rede host nem partilhar namespace de um Hub com internet/serviços irrestritos. Não abrir endpoint externo apenas para contornar loopback.
3. Montar somente configuração mínima; nunca socket Docker, diretório pessoal completo, segredos n8n ou volumes de outros clientes. Limitar RAM/CPU/PIDs e usar filesystem readonly com tmpfs onde necessário após teste de compatibilidade.
4. Testar de fato ausência de rede/segredos de vizinhos, kill, restore dos ledgers e rejeição sem autorização. O subproccesso local usado nos testes não é essa sandbox.

O Docker não está disponível neste ambiente de trabalho. Não há container iniciado, rede configurada nem instalação/alteração remota na VPS. O runtime completo do Hermes exige isolamento próprio; este worker reduz capacidades, mas não certifica a segurança do upstream inteiro.

## n8n

Arquivo: `integrations/n8n/hermes-job.workflow.json`, gatilho manual e `active:false`. Selecionar uma credencial Header Auth protegida (`Authorization: Bearer …`) para o serviço worker, depois de validar o endpoint na topologia real. `127.0.0.1` dentro do container n8n é o próprio container, não a VPS. O destino não foi validado na sua instância; não ativar antes de homologar rede e credencial sem expor serviço público.

Os testes executam o JavaScript dos próprios nós Code e os endpoints HTTP localmente; não são execução real no n8n. Não foi importado nem ativado workflow nesta entrega. A saída fica para revisão, sem nós de escrita/publicação.

## Testes e reprodução

```sh
npm test
python3 -m unittest discover -s tests/hermes -v
```

Para o teste com imports reais do Hermes, definir caminhos de ambiente já preparado:

```sh
RADAR_HERMES_TEST_PYTHON=/caminho/testenv/bin/python RADAR_HERMES_TEST_SOURCE=/caminho/hermes-agent npm test
```

Sem esses dois caminhos, o teste real é explicitamente skipped; os demais rodam. A CI leve testa Node e o adapter Python stdlib, sem baixar Hermes. O registro real foi exercitado localmente no snapshot fixado; o carregamento automático do plugin no gateway/AIAgent e todas as chamadas de modelo continuam não homologados.

Nesta implementação: baseline 134 testes Node; após mudança 139/139 Node com Hermes real e 3/3 Python. Esses números são separados dos 169 testes da auditoria upstream anterior.

## Reversão e promoção

Entrega em branch/PR; remover plugin local e parar serviço remove a integração. Reverter commit não restaura dados apagados, logo conservar backup consistente dos ledgers. Não sobrescrever configuração ou estado de produção. Para promoção: testar imagem/rede, identidade real quando houver usuários, restore, workflow n8n manual e só depois decidir sobre geração assistida. Composio/Vercel não são dependências dessa fatia; permanecem opções sob demanda.
