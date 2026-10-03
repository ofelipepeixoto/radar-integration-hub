# ADR — manter fronteira HTTP/JSONL restrita antes de MCP

Data: 2026-10-03. Estado: aceito para o laboratório, condicionado à homologação dos consumidores.

O main oferece uma CLI. A composição local incorpora o HTTP autenticado somente leitura, o adapter OpenClaw e o bridge JSONL do PR #1 (`50c7594b9495cee64de6a4d01173b08f15ec6ca9`). O JSONL usa `radar-jsonl-v1`; **não é MCP**. Os testes confirmam o cliente e o HTTP reais em loopback com CRM fictício. Não confirmam carregamento no Gateway nem importação/execução n8n.

Decisão: não adicionar um servidor MCP, SDK ou catálogo extra nesta etapa. Há propostas de consumidores, mas ainda não existem dois consumidores operacionais homologados que justifiquem a camada. Um pacote de instruções do plugin orienta trabalho; não oferece automaticamente autenticação, conexão à VPS ou inventário `tools/list`.

Quando houver necessidade comprovada, avaliar um adapter MCP read-only para o Hub usando SDK oficial e versão fixa. O primeiro contrato deve manter somente `radar_crm_preview`, argumentos vazios, tenant de configuração confiável, sem URL/header/credencial/ação configurável. Verificar `initialize`, `tools/list`, `tools/call`, limites, cancelamento e clientes reais. Não expor aprovação/pagamento ou sugerir que hints MCP substituem autorização. Reavaliar transporte e autenticação; a identidade de serviço atual não autentica pessoas nem representa multi-tenancy SaaS.

Preferir o MCP oficial da instância n8n para capacidades que ela já oferece, após verificar versão e ferramentas reais. O servidor Hub seria responsável por contratos de domínio ausentes, se essa ausência for demonstrada. Nesta entrega não há instalação MCP, criação de console, acesso à VPS ou mudança de política n8n.
