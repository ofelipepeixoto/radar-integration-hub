# Estudo Dify: falha, reserva e diagnóstico

Implementação original de Carlos Felipe, MIT, em **STUDY**. Referência conceitual:
[Dify](https://github.com/langgenius/dify/tree/2de5d891cbd5f59314f1813fc1db7c623ad762e3),
auditado em 11/10/2026. Não contém código, frontend, plugins ou patches derivados
do Dify. Esses patches permanecem separados nas evidências privadas da auditoria.

## Executar e verificar

Node 22.13+; biblioteca padrão, sem instalação de dependências:

```sh
node studies/dify/lifecycle.mjs
node --test test/dify-study.test.mjs
npm test
```

O runner reutiliza **GovernanceStore real**, com SQLite temporário, identidades
fictícias e custo inteiro ilustrativo de 100 microunidades. A configuração
`paidEnabled: true` existe apenas nesse store descartável para exercitar a
contabilidade; não altera configuração do HTTP, CLI live, n8n, OpenClaw ou outros
stores. O runner não tem adapter de rede/provedor e não faz uma chamada paga.
Encerra o banco e remove o diretório no finally, inclusive em erro.

| Cenário | Resultado esperado |
| --- | --- |
| Reserva não iniciada | Cancelamento libera capacidade; ID permanece consumido |
| Execução iniciada, resultado desconhecido | Cancelamento negado; custo não é assumido zero |
| Reabertura do SQLite | Estado iniciado preservado, novo start negado |
| Nova tentativa sem capacidade | BUDGET_EXCEEDED; sem reserva/chamada adicional |
| Falha no bridge existente | Código estático, sem retry; busy liberado para outro request |
| Observabilidade existente | Campos permitidos; URL, body, headers e erro arbitrário descartados |

## O que este estudo demonstra

Limpar recursos de transporte após uma falha é diferente de liberar orçamento
de uma operação cujo efeito ficou incerto. A auditoria motivou os cenários; os
controles exercitados já pertenciam ao Hub. Não é uma correção de defeito no Hub,
um executor novo, um fluxo Dify integrado ou um autenticador.

Reabrir o banco ocorre no mesmo processo; não é um teste adicional de crash,
Redis distribuído ou autenticação depois de reiniciar. O bridge usa ferramenta
sintética; o teste de observabilidade examina o objeto gerado, não todos os sinks.
Nenhum cenário certifica pessoas, custo de provedor, n8n ou produção. A saída
sempre declara providerCalled, humanIdentityVerified e productionVerified false.

Próximo gate: revisão humana desta fatia e escolha de um consumidor real.
Integrações e runtime pago exigem autenticação, accounting confiável e homologação
próprias. Reversão: remover os três arquivos do estudo; nenhum serviço foi ativado.
