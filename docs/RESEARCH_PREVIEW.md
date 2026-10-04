# Prévia offline de pesquisa — laboratório

## Resultado disponível

O consumidor original do Hub chama o evidence-kit local e devolve grupos de
texto com cada referência documental. A fixture possui dois documentos com o
mesmo texto Unicode; o resultado conserva duas ocorrências. Não há LLM ou
resposta inventada: somente texto existente, referências e contagens.

O kit utilizado está fixado em
[`3008c8dbb3e950a7ba0c6794576880f91d85a65d`](https://github.com/ofelipepeixoto/radar-evidence-kit/tree/3008c8dbb3e950a7ba0c6794576880f91d85a65d),
proposto na [PR #3](https://github.com/ofelipepeixoto/radar-evidence-kit/pull/3).
O consumidor não instala nem modifica esse componente em execução.

## Executar o cenário sintético

Requer Node 22.13+ e Python 3.11+. Na raiz do Hub com esta PR aplicada:

```bash
git clone https://github.com/ofelipepeixoto/radar-evidence-kit.git .audit-deps/radar-evidence-kit
git -C .audit-deps/radar-evidence-kit checkout --detach 3008c8dbb3e950a7ba0c6794576880f91d85a65d
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
e flags de autoridade. Hashes não comprovam verdade ou autenticidade do original.
Emissor/revisor/Scope precisam de autenticação externa; as fixtures usam flags
de review/identidade sintéticas, por isso `issuerVerified` permanece falso.

Registros de outro cliente/projeto, revisão antiga, desconhecidos, rejeitados,
pendentes ou sem indicador de identidade são excluídos pelo kit antes de agrupar.
Ausência de registros elegíveis produz `abstained`. Contratos inválidos não
devolvem resultado parcial nem ecoam conteúdo/erro do processo.

O FileLedger reserva a tentativa antes de ler: replay bloqueado no mesmo dia
UTC, cota de 10 tentativas por tenant/dia, falhas também contam. O ledger é local;
não é idempotência distribuída e o ID pode ser reutilizado em outro dia. Sem
efeitos externos neste caminho. A biblioteca financeira SQLite existente
permanece separada e desabilitada por padrão; não há provedor pago a integrar.

## Evidência desta implementação

Localmente: Hub **141 aprovados**; interoperabilidade Node/Python real **6
aprovados**; kit **96 aprovados e 3 opcionais Semantica ignorados**. Os três
controles representam conjuntos diferentes. A CI executa a interoperabilidade
com o commit acima fixado; seu status deve ser confirmado nos checks da PR.

O conjunto interop testa duas origens, Unicode, exclusão de escopo/review/revisão,
payload/hash adulterado, JSON duplicado, falta de Python, tamanho de input,
timeout, teto de output durante processo e ausência de chaves herdadas.

## Próximos gates

Antes de atender usuários reais: verificar bytes dos originais e identidade do
emissor/revisor, autenticar tenant/projeto no backend, avaliar corpus reservado,
definir retenção e persistência. Qualquer LLM pago exige reserva financeira
persistente antes da chamada e reconciliação; qualquer publicação exige proposta
específica aprovada. Instalação Odysseus, Supabase/n8n/VPS e escala permanecem
trabalhos condicionais. Veja [ADR](adr/0002-research-preview-boundary.md) e
[auditoria histórica](audits/odysseus/2026-10-04/README.md).
