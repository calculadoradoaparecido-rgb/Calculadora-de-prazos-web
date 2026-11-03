# Revisão técnica de segurança — versão web

Esta revisão melhora práticas do código, mas não representa certificação nem aprovação do TJCE. A liberação do domínio e a autorização de uso institucional dependem da SETIN/segurança da informação.

## Alterações desta versão

- Proxy com allowlist de hosts e de caminhos, restrição do POST a formulários esperados, limite do corpo da requisição e do tamanho de resposta.
- Redirecionamentos são seguidos manualmente e cada destino é validado novamente; redirecionamentos de POST são bloqueados.
- O proxy não encaminha cookies, cabeçalhos de autenticação ou credenciais do navegador.
- Cabeçalhos de segurança e Content Security Policy em `_headers` para Cloudflare Pages.
- Aviso visível de que a ferramenta é independente, e página com explicação de armazenamento, consultas externas e limitações.

## Antes de uso institucional

1. Solicitar à SETIN aprovação do código, do ambiente de hospedagem, do domínio e do fluxo de dados.
2. Testar todas as rotas realmente usadas pelo calendário e DJEA após as restrições no proxy. Se uma rota legítima for bloqueada, adicionar somente o caminho necessário após confirmação técnica — não reabrir uma proxy genérica.
3. Rever com a TI a política de retenção de logs do provedor da hospedagem e os avisos de privacidade.
4. Fazer testes funcionais de cálculo, importação/exportação, atualização, permissões e persistência em Chrome e Edge.
5. Não inserir dados processuais sigilosos ou credenciais na hospedagem pública.

## Limitação conhecida

A política do filtro da VPN indicou a categoria `personal-sites-and-blogs` para `prazos-tjce-web.pages.dev`. Alterações no código não mudam necessariamente a categoria atribuída ao domínio. A correção do bloqueio requer avaliação/reclassificação formal pelo responsável pelo filtro ou hospedagem institucional aprovada.
