# Controle de segredos

Controle original Carlos Felipe/Radar, MIT. Scanner externo Gitleaks `v8.30.1`, MIT, Zachary Rice e contribuidores. O install script obtém somente o asset oficial Linux x64, verifica SHA-256 fixado antes de extrair/executar e conserva o LICENSE. Nenhum núcleo upstream foi incorporado ao repositório.

`segredos.yml` usa `pull_request_target` com `contents:read`: **somente os executáveis e a política do checkout da base confiável são executados**. O histórico da PR é dado, num mirror bare, sem executar seus scripts, hooks, workflows ou package hooks. Checkouts não persistem credenciais. O wrapper ignora `.gitleaksignore`, comentários de allowlist e regras locais do alvo; exige versão exata e histórico completo alcançável. Não faz chamadas a provedores.

Resultado: exit 0 sem candidatos; exit 1 com candidatos; exit 2 para erro/timeout/histórico raso/configuração inválida. Todos devem bloquear avanço conforme a política do operador. Não usar `continue-on-error`. Configuração, wrapper e workflow de segurança na base precisam de revisão separada e proteção apropriada; um mantenedor que muda a base pode alterar o controle.

O wrapper captura stdout/stderr e descarta texto upstream. O resumo inclui somente regra, commit e linha, sem segredo, match, caminho, autor, email ou mensagem de commit. Evitar `--verbose`: a auditoria encontrou um caso multipart de redaction incompleta nessa saída. Os testes sintéticos reproduzem o defeito e confirmam que o wrapper não o exporta. Resultado limpo não certifica ausência de todo segredo nem cobre arquivos não versionados, logs, VPS, credenciais n8n ou histórico inalcançável.

## Bootstrap e gate

Este é um repositório público; não há garantia de proteção de branch configurada nesta implementação. Na primeira PR, a base ainda pode não ter o script/política do scanner: o job falha fechado até esses controles entrarem na base por um bootstrap revisado. Só depois de observar o job remoto no SHA correspondente, tornar seu nome um check obrigatório quando os recursos da conta permitirem. Não declarar CI confirmado a partir dos testes locais.

O workflow `scanner-fixtures.yml` testa código proposto com fixtures sintéticas num job `pull_request` separado, sem segredos. Ele não substitui o gate de histórico com política da base. A CI Node existente foi preservada.

## Verificar localmente

```bash
bash scripts/install_gitleaks.sh /tmp/radar-gitleaks
RADAR_GITLEAKS_BINARY=/tmp/radar-gitleaks/gitleaks python3 -m unittest discover -s tests -p 'test_secrets.py' -v
python3 scripts/scan_secrets.py --binary /tmp/radar-gitleaks/gitleaks --repository . --config .security/gitleaks.toml --report /tmp/radar-gitleaks/hub-summary.json
```

Se houver um candidato, investigar em ambiente restrito sem publicar seu valor. Caso seja credencial real, revogar/rotacionar no emissor e avaliar uso; apagar texto sozinho não revoga uma credencial nem remove histórico. Não foi encontrado ou conectado nenhum emissor nesta preparação.
