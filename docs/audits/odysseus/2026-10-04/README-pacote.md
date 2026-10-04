# Pacote de verificação — auditoria Odysseus / Radar

Commit upstream: `2992bf6d368a11472323e47d3bfed91e79cefc6b`, branch `dev`.
O relatório principal contém a decisão B — STUDY e as 30 seções solicitadas.

## Conteúdo

- Relatório, manifest de snapshots e registro de verificações.
- `reproduce_audit.py`: cinco reproduções sintéticas de limitações do snapshot original.
- `reproduction-results.json`: saída observada. Êxito das assertions confirma as limitações, não segurança do produto.
- `proposed-rag-owner-filter.patch`: filtro no backend do fallback lexical; proposta upstream AGPL.
- `test_proposed_fallback.py`: três regressões contra um checkout com o patch realmente aplicado.
- `audit-environment.txt`: freeze do ambiente parcial de testes. Não é lock completo da aplicação.
- `LICENSE-upstream-AGPL-3.0.txt`: licença do código upstream a que o patch se aplica.
- `SHA256SUMS.txt`: integridade dos arquivos desta entrega.

Nenhum dado real de cliente, segredo ou documento privado de infraestrutura é incluído. O código completo upstream não está redistribuído aqui. As análises/scripts novos foram produzidos para esta auditoria; não atribuem a Carlos Felipe a autoria do Odysseus. O patch modifica código upstream AGPL e mantém as obrigações/atribuições aplicáveis. Não relincenciar esse código como MIT.

## Preparar ambiente reproduzível

Com Git e Python 3.12 disponíveis, em diretório de trabalho novo, colocar este pacote numa pasta `pacote`:

```bash
git clone --branch dev https://github.com/odysseus-dev/odysseus.git odysseus
git -C odysseus checkout --detach 2992bf6d368a11472323e47d3bfed91e79cefc6b
python3 -m venv .venv
.venv/bin/python -m pip install -r pacote/audit-environment.txt
.venv/bin/python -m pip check
.venv/bin/python pacote/reproduce_audit.py "$PWD/odysseus"
```

As reproduções importam módulos upstream sem iniciar app/serviços. Usam doubles para Chroma e DNS, extração AST de uma migração e um arquivo temporário sintético para shell. A migração não conecta ao PostgreSQL. A prova DNS não executa rebinding pela rede. O shell não lê arquivos reais do usuário.

## Verificar patch

O checkout original deve permanecer inalterado para comparação:

```bash
git -C odysseus apply --check "$PWD/pacote/proposed-rag-owner-filter.patch"
git -C odysseus worktree add --detach "$PWD/odysseus-patched" 2992bf6d368a11472323e47d3bfed91e79cefc6b
git -C odysseus-patched apply "$PWD/pacote/proposed-rag-owner-filter.patch"
ODYSSEUS_AUDIT_ROOT="$PWD/odysseus-patched" ODYSSEUS_BASELINE_ROOT="$PWD/odysseus" .venv/bin/python -m pytest -q pacote/test_proposed_fallback.py
```

Resultado observado: **3 aprovados**. O double de coleção recebe `where`; demonstra a redução de registros materializados e a preservação de resultados. Falta validar com serviço Chroma real. O patch não corrige identidade/proveniência, paginação, isolamento organizacional ou uso administrativo sem owner. Doubles antigos upstream que não aceitam `where` precisam ser compatibilizados antes de incorporar o patch.

## Reexecutar suite upstream dirigida

```bash
cd odysseus
../.venv/bin/python -m pytest -q tests/test_url_safety.py tests/test_api_chat_security.py tests/test_tool_approvals.py tests/test_tool_approval_single_action_scope.py tests/test_tool_approval_task_scope.py tests/test_prompt_security.py tests/test_rag_keyword_fallback_owner.py tests/test_shell_service.py tests/test_workspace_confine.py tests/test_auth_session_revocation.py tests/test_api_token_tool_authority.py
```

Resultado observado: **145 aprovados**. A suite completa de **5.945 aprovados/11 ignorados** foi confirmada nos logs remotos do mesmo SHA e não repetida localmente. Instalar o freeze não instala todos os requisitos/OCR/browser/modelos do produto; não usar este ambiente parcial como deployment.

## Testes do Hub

No commit `93c88ffb297edae3f827a98fe2ffe7d59cff56aa` do `ofelipepeixoto/radar-integration-hub`, com Node 24.19.0:

```bash
node --test test/governance.test.mjs test/observability.test.mjs test/runtime.test.mjs
```

Resultado observado: **52 aprovados**, com identidades/custos sintéticos e servidor CRM de teste em loopback. Não confirma identidade humana real, n8n ativo, deployment de Gateway ou integração com Odysseus.

## Limites e próximo gate

Não foram feitos build Docker, E2E browser, carga, conexões reais Chroma/PostgreSQL, execução n8n, alterações Supabase, chamadas pagas ou implementação remota. O próximo gate é avaliar um caso de pesquisa reservado e comparar resultado/custo com o fluxo atual, mantendo ferramentas perigosas e gastos desabilitados.
