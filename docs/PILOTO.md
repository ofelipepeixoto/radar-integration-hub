# Piloto: consulta governada do CRM

## Resultado a validar

Camaleão Growth: um operador revisa uma amostra de negócios por etapa com a conta correta e permissão de leitura, sem manusear o token do CRM. A existência de conta HubSpot e a necessidade do usuário devem ser confirmadas antes da conexão real.

## Etapas

1. **Entregue:** laboratório local com fixtures, 31 testes, ledger persistente, cota de 10 tentativas por cliente/dia UTC e adaptador REST simulado.
2. **A validar em ambiente de teste:** autenticação real do operador, binding confiável, provedor/escopos, OAuth, renovação e revogação. Nenhuma conta conectada na entrega.
3. **A medir:** tempo do processo atual e do piloto, consultas válidas por tentativa, erros, p95, 429, bytes e custo registrado pelo fornecedor. Resultados ainda não medidos.
4. **Antes de produção:** reserva transacional distribuída, auditoria com retenção, budget de conta, isolamento, restauração, aprovação do modelo comercial/licenciamento e revisão de acesso.

## Critérios de avanço

- Todas as consultas entre clientes diferentes bloqueadas nos testes e no fluxo autenticado real.
- Credenciais ausentes de resultados, prompts e logs; escopos mínimos e revogação exercitada.
- Cota aplicada mesmo em falhas; despesas dentro de orçamento explícito do piloto.
- Resultado útil validado pelo operador e tempo comparado com uma baseline medida, sem inferir ROI de fixtures.
- Ações de escrita continuam indisponíveis nesta versão. Sua inclusão exige política por ação, aprovação vinculada ao conteúdo e identidade, validade, idempotência e auditabilidade.

## Escolha da edição

Usar fixtures enquanto não houver necessidade concreta de OAuth real. Para teste real, escolher edição conforme contrato necessário e orçamento. A implementação atual aponta apenas para Nango Cloud; hospedagem própria requer mudança revisada de configuração e validação da rede, não uma URL fornecida pelo usuário ou pelo LLM.

Manter n8n e demais projetos existentes. Nango deve entrar somente onde a gestão de contas de clientes demonstrar benefício sobre as integrações já disponíveis.
