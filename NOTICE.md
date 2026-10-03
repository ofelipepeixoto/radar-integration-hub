# Origem e limites das licenças

Radar Integration Hub é um projeto independente, de Carlos Felipe / ecossistema Radar. O código deste repositório foi escrito para este laboratório; não contém cópia do núcleo nem do SDK Nango.

Referência técnica: [NangoHQ/nango](https://github.com/NangoHQ/nango), copyright Nango Inc. O projeto de origem usa [Elastic License 2.0](https://github.com/NangoHQ/nango/blob/7e61a4c97b5a638bcf01808016099de2fe2f9985/LICENSE). O adaptador deste laboratório usa o contrato HTTP documentado pelo fornecedor.

A licença MIT cobre somente os arquivos originais deste repositório. Ela não concede direitos adicionais sobre Nango, HubSpot, marcas, serviços ou dados de terceiros.

ELv2 permite uso, modificações e distribuição sob condições. Restringe fornecer funcionalidades substanciais do software a terceiros como serviço hospedado/gerenciado, contornar proteções por chave de licença e remover/ocultar avisos. Cópias modificadas também precisam identificar suas modificações. A existência de um repositório independente não elimina essas obrigações.

Este laboratório não substitui a análise do modelo comercial antes de lançar um serviço baseado no núcleo Nango. Não foi negociada licença Enterprise ou autorização comercial adicional com o fornecedor.

## Integração OpenClaw

O servidor `src/service.mjs`, o transporte `plugins/openclaw-radar/tool.mjs`, os testes e a documentação de integração foram escritos originalmente para Carlos Felipe / Radar. Não foram extraídos do núcleo OpenClaw.

Referência de contrato e arquitetura: [OpenClaw Foundation / openclaw](https://github.com/openclaw/openclaw/tree/c074824a27c96d3983043f9eeb33823cd1772d8c), release `2026.9.7`, MIT, copyright 2026 OpenClaw Foundation. O entrypoint consome o SDK do host como dependência externa, sem vendorizá-lo. Não há vínculo oficial, parceria ou cessão de marca implícitos.

Se uma versão futura redistribuir código OpenClaw ou outras dependências, deverá acompanhar seus avisos originais, incluindo avisos transitivos aplicáveis. A autoria dos componentes externos permanece com seus autores.
