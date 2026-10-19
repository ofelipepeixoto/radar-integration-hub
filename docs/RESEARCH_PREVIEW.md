# Prévia offline de pesquisa — laboratório

## Resultado disponível

O consumidor original do Hub chama o evidence-kit local e devolve grupos de
texto com cada referência documental. A fixture possui dois documentos com o
mesmo texto Unicode; o resultado conserva duas ocorrências. Não há LLM ou
resposta inventada: somente texto existente, referências e contagens.

O kit utilizado está fixado em
[`2ffc5a407a29bf5d027142068709d64a2293d3ce`](https://github.com/ofelipepeixoto/radar-evidence-kit/tree/2ffc5a407a29bf5d027142068709d64a2293d3ce),
proposto na [PR #3](https://github.com/ofelipepeixoto/radar-evidence-kit/pull/3).
O consumidor não instala nem modifica esse componente em execução.

## Executar o cenário sintético

Requer Node 22.13+ e Python 3.11+. Na raiz do Hub com esta PR aplicada:

```bash
git clone https://github.com/ofelipepeixoto/radar-evidence-kit.git .audit-deps/radar-evidence-kit
git -C .audit-deps/radar-evidence-kit checkout --detach 2ffc5a407a29bf5d027142068709d64a2293d3ce
RADAR_EVIDENCE_KIT_PATH="$PWD/.audit-deps/radar-evidence-kit/src" node scripts/verify-research-pin.mjs
RADAR_EVIDENCE_KIT_PATH="$PWD/.audit-deps/radar-evidence-kit/src" npm run demo:research
RADAR_EVIDENCE_KIT_PATH="$PWD/.audit-deps/radar-evidence-kit/src" npm run test:research
npm test
```

Não exige pip/npm install, chave ou conta. `RADAR_EVIDENCE_PYTHON` é configuração
opcional do operador para selecionar o executável Python do ambiente homologado;
não é argumento de ferramenta/request. `npm test` sozinho continua sem Python.
O demo usa diretório de estado temporário, removido ao encerrar. Para biblioteca
persistente, configurar o ledger fora do demo e conservar suas regras de custódia.

Saída esperada: `decision: needs_review`, `includedOccurrences: 2`, um grupo e
duas referências; `paidCallsEnabled`, `externalActionsEnabled` e `issuerVerified`
permanecem `false`. Nenhuma saída libera publicação ou gasto.

## Contrato e fronteira de confiança

`createResearchPreview` recebe tenant/projeto, ledger e reader na inicialização.
`execute` aceita apenas `{requestId}`; o tenant autenticado deve vir do backend.
O demo usa uma identidade sintética local, sem sessão de pessoa real. Não foi
adicionada rota HTTP nem ferramenta no OpenClaw/JSONL existente.

Scope e snapshot são arquivos locais definidos pelo operador. O reader chama
somente `python -P -m radar_evidence.research_preview --scope <arquivo>` com
`shell: false`. O processo não herda chaves do Hub; tem timeout de 3 segundos
(configurável entre 100 ms e 5 s), stdin de 256 KiB, stdout de 1 MiB e stderr
descartado/limitado. O Python também limita a leitura de Scope/stdin a 256 KiB.
Não se trata de sandbox de SO: paths, módulo e Python devem ser confiáveis.

A prévia é verificada novamente no Node: schema/escopo, contagens, SHA-256 do
texto e identidade de ocorrências, quotes/spans por code point Unicode, repetição
e flags de autoridade. O reader retorna internamente `{preview, snapshot}`:
o snapshot é capturado dos mesmos bytes enviados ao processo, sem reler o arquivo
após a execução, e não entra na resposta de `execute`. O Node recalcula o
`evidenceId` de todos os campos do registro original e confere a referência e
seus dados, exigindo IDs únicos na saída. As contagens somam o número real de
registros de entrada; exclusões e replays são reconciliados com os registros
representados. Um reader personalizado deve fornecer esse envelope interno,
nunca somente a prévia. Hashes não comprovam verdade ou autenticidade do original.
Emissor/revisor/Scope precisam de autenticação externa; as fixtures usam flags
de review/identidade sintéticas, por isso `issuerVerified` permanece falso.

Registros de outro cliente/projeto, revisão antiga, desconhecidos, rejeitados,
pendentes ou sem indicador de identidade são excluídos pelo kit antes de agrupar.
Antes dessa exclusão, o kit compara todos os recibos da mesma ocorrência. Se
uma ocorrência que seria incluída tiver decisão/revisor/identidade divergente,
a prévia inteira falha com `EVIDENCE_PREVIEW_DENIED`, inclusive quando o outro
recibo é inelegível e independentemente da ordem. Não é permitido selecionar a
decisão mais recente pela posição no arquivo. Conflitos somente entre ocorrências
excluídas pelo Scope não afetam fontes elegíveis independentes.
Ausência de registros elegíveis produz `abstained`. Contratos inválidos não
devolvem resultado parcial nem ecoam conteúdo/erro do processo.

O FileLedger reserva a tentativa antes de ler: replay bloqueado no mesmo dia
UTC, cota de 10 tentativas por tenant/dia, falhas também contam. O ledger é local;
não é idempotência distribuída e o ID pode ser reutilizado em outro dia. Sem
efeitos externos neste caminho. A biblioteca financeira SQLite existente
permanece separada e desabilitada por padrão; não há provedor pago a integrar.

## Evidência desta implementação

Localmente: Hub **141 aprovados**; interoperabilidade Node/Python real **6
aprovados** na primeira versão. Após a correção P1 de recibos conflitantes:
Hub **143 aprovados**; interoperabilidade **9 aprovados**; kit **100 aprovados e
3 opcionais Semantica ignorados**. Os três
controles representam conjuntos diferentes. A CI executa a interoperabilidade
com o commit acima fixado e verifica que o checkout corresponde ao manifesto
`research-dependencies.json`, sem alterações rastreadas. Esse preflight detecta
divergência entre SHA do workflow e manifesto; não autentica o módulo/emissor nem
garante segurança de arquivos locais não rastreados. Corrigir ou incorporar o
Kit isoladamente não atualiza o Hub. O status deve ser confirmado nos checks da PR.

O conjunto interop testa duas origens, Unicode, exclusão de escopo/review/revisão,
payload/hash adulterado, JSON duplicado, falta de Python, tamanho de input,
timeout, teto de output durante processo e ausência de chaves herdadas. Inclui
conflitos de recibo nas duas ordens e falhas simuladas de um adapter Python que
altera IDs ou contagens; esse último caso é injeção de falha, não comportamento
atribuído ao Kit corrigido.

## Próximos gates

Antes de atender usuários reais: verificar bytes dos originais e identidade do
emissor/revisor, autenticar tenant/projeto no backend, avaliar corpus reservado,
definir retenção e persistência. Qualquer LLM pago exige reserva financeira
persistente antes da chamada e reconciliação; qualquer publicação exige proposta
específica aprovada. Instalação Odysseus, Supabase/n8n/VPS e escala permanecem
trabalhos condicionais. Veja [ADR](adr/0002-research-preview-boundary.md) e
[auditoria histórica](audits/odysseus/2026-10-04/README.md).
