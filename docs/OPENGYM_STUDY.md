# Estudo openGym: propostas locais validadas

Decisão B — STUDY, aplicada em uma extensão original do Radar Integration Hub.
Referência conceitual: DuarteSantos8/openGym, SHA
`464355ef43d4c8f8a4e0bb6db9c2af7f240593b5`: separar geração, parse,
validação e reparo limitado. Nenhum código, prompt, catálogo ou mídia desse
projeto foi copiado. A implementação nova permanece MIT, Carlos Felipe;
o upstream e seus assets conservam suas licenças próprias.

`src/draft-proposal.mjs` recebe uma função produtora confiável e IDs de evidência
definidos pela aplicação. Aceita exclusivamente JSON `{text, evidenceIds}`,
com limites de bytes/comprimento, IDs únicos e pertencimento ao escopo.
A saída é uma proposta local não aprovada. Não concede permissão, não executa
ferramentas e não autentica pessoas. Texto validado estruturalmente não significa
fato comprovado: IDs existentes não demonstram que sustentam a afirmação.

Uma resposta inválida admite um reparo. Exceções do produtor terminam sem retry
e sem revelar seu erro. O produtor recebe contador, indicador de reparo e IDs;
não recebe automaticamente a resposta inválida anterior. Não há transporte,
credenciais, custos ou timeout implementados. Para conectar um provedor real,
o servidor precisa limitar duração/cancelamento e reservar orçamento antes de
cada chamada. Nunca fornecer função produtora que execute efeitos externos.
Um produtor que não termina ainda pode bloquear a espera; não expor este módulo
como endpoint até implementar e testar transporte com cancelamento.

A integração com GovernanceStore, autenticação de produção, Evidence Kit,
n8n, MCP e IA paga está pendente. Nenhuma ação da allowlist foi acrescentada.
Não usar diretamente um tenant, ação ou aprovação devolvido por modelo.

Validação: `node --test test/draft-proposal.test.mjs` e `npm test`.
Os oito testes novos cobrem reparo máximo, falhas, limites, campos de execução,
evidência desconhecida, proposta imutável e mutação do escopo durante await.

Próxima camada: contrato de submissão ligado à identidade autenticada e revisão
humana, com evidências reais permitidas e testes negativos, antes de qualquer
provider pago ou workflow ativo. Este estudo não cria um produto fitness.
