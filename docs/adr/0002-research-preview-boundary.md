# ADR 0002 — Pesquisa offline subordinada ao Hub

Data: 2026-10-04. Estado: implementação de laboratório, proposta em PR.

## Decisão

Aplicar a decisão B — STUDY da auditoria Odysseus. Publicar evidências do estudo
e implementar uma prévia estreita nos projetos existentes, preservando autoria
e licenças. Não instalar/forkar o workspace amplo nesta etapa.

O pedido contém apenas `requestId`. Tenant/projeto, snapshot, Scope e caminho
Python vêm do operador. A execução usa módulo Python fixo do evidence-kit,
`shell: false`, ambiente sem chaves herdadas, timeout e limites durante leitura.
Esse processo de contrato não é uma ferramenta shell oferecida ao modelo.

O kit filtra elegibilidade e conserva ocorrências distintas. O Hub verifica
schema, escopo, hashes de conteúdo/ocorrência, spans Unicode, contagens e flags.
Os testes interop chamam Python de verdade; fixtures e identidade continuam
sintéticas. Não há autenticador remoto, usuário humano homologado ou verificação
dos bytes originais. O resultado declara `issuerVerified: false`.

Reutilizar `FileLedger` para a cota/replay por tenant/dia UTC do laboratório.
Não alterar sua semântica nem afirmar idempotência durável entre dias. Falhas
consomem tentativa; crash com lock exige recuperação pelo operador, como no CRM.
Não há ação externa a duplicar neste piloto.

## Custos e autoridade

O caminho não possui cliente LLM, e-mail, publicação, URL dinâmica, Docker,
terminal genérico ou API paga. Pedidos com esses campos são recusados antes do
adapter. A reserva financeira existente em `GovernanceStore` permanece
desabilitada por padrão; não afirmar integração com provedor que ainda não existe.

Qualquer evolução paga deve exigir reserva persistente antes da chamada,
aprovação de payload/custo/tenant e reconciliação de timeout/retry. Qualquer
publicação deve exigir autorização específica e executor determinístico.

## Alternativas e gates

Reusar o contrato de evidências evita segundo indexador e banco nesta fase.
MCP continua condicionado ao ADR existente. Odysseus como trabalhador isolado
é futuro condicional a benefício mensurado, licença, egress, orçamento, tenancy,
backup e carga; não uma consequência automática do sucesso destas fixtures.
