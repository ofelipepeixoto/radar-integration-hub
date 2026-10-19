# Nanobrowser: reprodução de dois candidatos da auditoria

Decisão **B — STUDY**. Este diretório versiona os dois patches e seus 26 testes da auditoria de 07/10/2026. A extensão não é dependência, plugin ou ferramenta do Hub. Não abre perfil real nem chama modelos.

Upstream: https://github.com/nanobrowser/nanobrowser, commit `ad47282a17ecdfb894745af093e0f7332fc1f71a`. `manifest.json` fixa origem, ferramentas e SHA-256 de cada patch/licença. Os testes novos estão dentro dos patches; não é preciso copiar outros arquivos.

## Reproduzir

Ambiente descartável com Git, Python 3, Node 24.19.0 e Corepack. Rede necessária para baixar fonte e dependências. Não forneça credenciais ou monte um perfil de navegador. Na raiz do Hub:

```bash
bash experiments/nanobrowser-patches/reproduce.sh
```

O script verifica integridade, baixa o commit fixado em diretório temporário, instala o lockfile com scripts desativados, prepara os tipos e executa os testes originais. Depois aplica os patches e executa tipos, testes, build e lint dos quatro arquivos alterados. O diretório temporário é removido ao terminar. A CI repete esse processo sem secrets.

Resultados locais da auditoria: **214 testes originais; 240 no candidato (26 novos)**. Tipos/build e lint dos arquivos alterados passaram. Ao executar apenas os novos testes antes dos patches: 13 falham e 13 passam. CI do novo PR fornece a reprodução independente. O lint global tinha um erro e seis avisos; os patches não tratam isso nem os três avisos de dependências de desenvolvimento encontrados na auditoria. Não se declara segurança integral aprovada.

## O que muda e o que permanece aberto

| Patch | Correção candidata | Limite explícito |
| --- | --- | --- |
| `0001-canonical-url-policy.patch` | URLs HTTP(S) canônicas, rejeição de credenciais/controles, hostname/IPv6/portas e precedência de deny | Predicado não controla rede, DNS, aba ativa, redirects, sub-recursos ou efeitos de cliques. Domínios locais continuam possíveis sem allowlist. |
| `0002-delete-replay-history.patch` | Exclui mensagens e replay, limpa órfãos, impede ler replay órfão e propaga erros | Não torna escrita/exclusão concorrente transacional, não apaga disco forense e enumera armazenamento na limpeza total. |

Os testes simulam Chrome/storage. Ainda faltam E2E da extensão e revisão humana. Não instale o candidato em perfil operacional. Rollback: reverter o commit deste estudo; nenhum dado operacional é migrado ou apagado. Patches upstream podem ser revertidos em cópia descartável com `git apply -R`, na ordem inversa.

## Autoria e licença

Código original: contribuidores Nanobrowser, Apache-2.0, preservada em `LICENSE-APACHE-2.0.txt`. Os patches mantêm contexto original e identificam alterações de Carlos Felipe, com assistência de IA, em 07/10/2026. Os testes novos acompanham os patches sob Apache-2.0. Não se reivindica autoria do upstream nem uso de sua marca. O snapshot auditado não continha NOTICE; dependências conservam suas próprias licenças. Este README e o script de reprodução seguem MIT do Hub.
