# Estudo isolado de captura HTTP × navegador

Decisão **B — STUDY**, autorizada a partir da auditoria Nanobrowser de 07/10/2026. Implementação própria de Carlos Felipe, com assistência de IA, sob MIT. Nenhum código, extensão ou asset Nanobrowser é incorporado a este adapter. Os candidatos Apache-2.0 da auditoria estão em PR separado.

Objetivo: descobrir quando renderização agrega evidência em relação a HTTP simples e verificar controles antes de propor integração. Este diretório é um experimento executável com páginas sintéticas locais, não um serviço de captura pública. O Hub operacional não importa seus arquivos nem recebe dependências novas.

## Executar

Node ≥22.13, Linux com dependências do Chromium. Na raiz do Hub:

```bash
cd experiments/browser-readonly
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run check
node evaluate.mjs > results.local.json
```

A instalação baixa pacotes/binários; os checks e a avaliação acessam somente o servidor de fixtures criado pelo próprio processo em `127.0.0.1`, com porta efêmera. Não há chaves, LLM, API paga, perfil de usuário ou ativação n8n. O programa recusa argumentos CLI, URLs e propriedades de autoridade no pedido. Playwright 1.63.0 está fixado no lockfile; não use `npx` fora do diretório preparado.

`npm test` na raiz continua sendo a suíte original do Hub. Os checks do estudo têm extensão `.check.mjs`, são executados explicitamente e não exigem instalar Playwright para testar o Hub.

## Contrato e controles verificados

Entrada interna: `{sourceId, mode}`, com `mode` HTTP ou browser e `sourceId` presente no catálogo sintético. O catálogo/origem pertence ao processo de teste, nunca ao modelo ou a um corpo HTTP. Não existe endpoint, MCP tool ou opção para fornecer um site real.

1. Um GET HTTP sem cookies/credenciais baixa a fixture, sem redirects/retry. Recusa status diferente de 200, MIME inadequado, compressão, mais de 64 KiB ou prazo superior a 2 segundos.
2. HTTP extrai o contrato mínimo `<p data-radar-evidence>`. Browser renderiza os mesmos bytes com Chromium novo/contexto efêmero, no máximo 5 segundos para iniciar e 4 segundos para a coleta. Scripts inline são das fixtures confiáveis.
3. Interceptação precede a criação da página: só o documento principal é atendido, com a resposta já limitada. Outras requisições, métodos, origens, frames, popups e WebSockets são recusados; service workers e downloads ficam desativados. Tentativa observada de rede/efeito invalida a captura. Cookies/headers do navegador não são reenviados ao servidor HTTP.
4. Ausência ou ambiguidade de evidência gera abstenção; texto acima de 2.000 caracteres gera erro. O contexto/processo é fechado ao terminar, inclusive em erro.
5. O recibo contém identificador de fixture, hashes SHA-256 da resposta e do texto, método, tamanho, tempo e `review_status: pending`. Não imprime conteúdo, tarefa, URL completa ou credenciais. `identity_verified: false` evita apresentar o recibo experimental como autorização operacional.

Os checks usam servidor HTTP real e Chromium real; não substituem o navegador por mocks. Cobrem entradas/autoridade, corpo chunked excessivo, MIME/status/redirect, prazo, captura/abstenção, limite textual, POST, sub-recurso, iframe, WebSocket, popup, outra origem, service worker, isolamento de cookie/localStorage e identidade dos hashes.

**Limite importante:** interceptar Playwright não é isolamento de rede/OS. O sandbox do Chromium permanece no padrão Playwright (`false`); apenas fixtures próprias confiáveis são permitidas. Não há firewall de egress, isolamento de kernel, proteção SSRF geral, garantia sobre tráfego de fundo do Chromium ou isolamento de CPU/memória demonstrados. Não exponha este processo a páginas públicas, uploads ou HTML não confiável. A política de requests não concede autorização para cliques; nenhuma ferramenta de clicar/digitar é exposta.

Referências de implementação: [contextos e rotas](https://playwright.dev/docs/api/class-browsercontext), [service workers e interceptação](https://playwright.dev/docs/network), [CI](https://playwright.dev/docs/ci). As limitações de interceptação informam o escopo restrito; não são tratadas como uma barreira de produção.

## Comparação reproduzível

`fixtures.mjs` declara antecipadamente quatro casos e o gabarito: página estática, conteúdo criado por JavaScript, ausência e ambiguidade. `evaluate.mjs` faz três repetições alternando a ordem dos métodos, totalizando 24 capturas. Falha se qualquer resultado divergir do contrato; preserva recibos e latências individuais no JSON. Não contém prompts nem avaliação por outro modelo.

| Caso | Comportamento esperado HTTP | Comportamento esperado browser |
| --- | --- | --- |
| Estático | Evidência exata | Evidência exata |
| Renderizado por JS | Abstenção | Evidência exata |
| Sem campo | Abstenção | Abstenção |
| Dois campos | Abstenção | Abstenção |

Este é um teste funcional pequeno e desenhado para diferenciar os métodos, sem corpus separado de validação. A mediana local é descritiva; não se infere qualidade geral, p95, capacidade, custo de infraestrutura ou viabilidade comercial. Custo de provedores é zero porque nenhum é chamado; isso não significa infraestrutura gratuita. APIs reais não foram avaliadas.

Validação local inicial: os 134 testes do Hub passaram; instalação dos dois pacotes Playwright passou. O CDN de Chromium retornou HTML `Site Unavailable`, então navegador local não ficou disponível. A CI contém instalação e execução real obrigatórias; ausência de Chromium faz o job falhar, sem skip/mock ou falso resultado positivo. Verifique os checks do commit atual do PR e o JSON de avaliação nos logs antes de aceitar a comparação.

## Critérios para sair de STUDY

| Etapa | Critério de saída | Estado neste PR |
| --- | --- | --- |
| Reproduzir candidatos | 214 → 240 testes, tipos/build, origem/licença preservadas | PR separado de patches |
| Comparar métodos | Todos os checks e 24 capturas passam em Chromium real | Implementado; CI deve confirmar |
| Selecionar piloto | Tarefa pública concreta, corpus de validação separado, baseline HTTP/API e métricas de citações/abstenção | Pendente |
| Isolar execução | Worker não root com sandbox, egress externo controlado, quotas CPU/memória, diretório privado e testes de escape/redirect/DNS | Pendente |
| Governar jobs | Identidade do backend, ação nova restrita, aprovação vinculada a hash/versão, persistência, idempotência e retomada sem repetir efeitos | Pendente; não reutilizar aprovação CRM como autorização browser |
| Integrar evidência | Contrato validado no Evidence Kit/control plane, proveniência e revisão antes de publicar; retenção/exclusão testadas | Pendente |
| Integrar n8n | Somente gatilhos, acompanhamento e revisão por job ID; sem URL/credencial/código arbitrário e sem autoridade no payload | Pendente; nenhum workflow ativado |
| Piloto com provedor | Reserva financeira atômica, teto explícito, custo conciliado, qualidade/latência medidos e revisão humana | Pendente; pago desativado |

A decisão permanece STUDY mesmo que a CI passe. HTTP continua sendo a primeira opção; navegador é candidato para o subconjunto que depende de JS, condicionado aos critérios acima. Nenhuma fusão, implantação ou integração operacional está implícita no resultado.

Rollback: reverter o commit deste PR/remove-lo da branch; o experimento não migra banco, muda políticas operacionais nem escreve histórico do usuário.
