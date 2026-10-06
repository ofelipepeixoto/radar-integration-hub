# Instruções para agentes — Radar Integration Hub

Trabalhar apenas no escopo autorizado. Ler README, instruções de segurança e documentação dos componentes alterados. Preservar licenças, limites, isolamento e distinção entre laboratório e produção.

## Entrega revisável: critério de aceite

Se um coding agent gera um PR impossível de revisar, o trabalho não está concluído.
Aplicar este padrão em tarefas futuras de código e automação nos repositórios autorizados.

1. Planejar antes de implementar: definir objetivo, critérios de aceite e camadas com dependências explícitas. Mudança simples pode ter um único PR.
2. Dar a cada PR um objetivo coerente, diff compreensível e validação própria. Manter código, testes necessários e documentação da mesma mudança juntos; separar refatoração, formatação em massa e funcionalidades sem relação.
3. Usar PRs empilhadas para mudanças dependentes no mesmo repositório; preferir PRs independentes quando não houver dependência. Registrar base, ordem e links. Entre repositórios, usar links e versões fixadas; não chamar isso de stack nativa.
4. Trabalhar em ciclos: PLANO → PR 1 → TESTE → REVIEW → PR 2 → TESTE → REVIEW → MERGE. Revisar cada camada antes de consolidar a seguinte; camadas preparadas enquanto aguardam revisão humana ficam explicitamente pendentes.
5. Testar comportamento e riscos da camada, informar comando, resultado e o que não foi testado. CI verde e autorrevisão do agente não substituem revisão humana.
6. Descrever em linguagem simples problema, mudança, ordem de leitura, dependências, evidências, riscos e reversão. Identificar arquivos gerados, comando de reprodução e diferença entre código autoral e saídas geradas; não ocultar diffs grandes.
7. Se o diff exigir várias decisões independentes ou não puder ser explicado claramente, dividir antes da entrega. Exceções indivisíveis exigem justificativa e roteiro de revisão; não usar apenas contagem de linhas como critério.
8. Conferir proteções, checks e recursos disponíveis antes de operar stacks; não presumir que branches encadeadas já formam uma stack nativa. Se indisponível, manter PRs pequenas com dependências explícitas.
9. Após mudanças na base, atualizar dependentes e repetir a validação afetada. Não reescrever branches compartilhadas ou forçar push sem necessidade e autorização; nunca enfraquecer proteções para facilitar o merge.
10. Fazer merge somente com revisão humana, checks e autorização aplicáveis; não presumir aprovação por silêncio ou por testes. Na entrega, distinguir implementado, testado, pronto para revisão, aprovado e integrado. Não reestruturar PRs antigas automaticamente.

O padrão orienta o agente; não instala um bloqueio automático no GitHub, concede acesso ou autoriza produção.
