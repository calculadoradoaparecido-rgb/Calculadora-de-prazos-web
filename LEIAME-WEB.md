# Versão web — Prazos CPC/CPP e Feriados TJCE

## O que esta adaptação já faz
- Mantém a interface e os módulos de cálculo da extensão.
- Usa IndexedDB no navegador em vez de `chrome.storage`, com migração dos dados antigos de `localStorage`.
- Os dados permanecem separados por servidor e por navegador/perfil.
- Links externos abrem em nova aba.

## Limitação importante antes de publicar para uso real
A coleta automática no DJEA e no calendário do TJCE precisa ser validada no Cloudflare Pages. A busca no DJEA usa o proxy para contornar CORS. A página oficial do calendário inclui eventos nos elementos ocultos `.eventos_calendario`; a versão web agora lê esses registros diretamente do HTML recebido pelo proxy. Recursos que dependem de background/offscreen e de varrer uma aba visual continuam indisponíveis na web. Se a página oficial deixar de incluir esses elementos, a importação informa a falha e preserva os dados já salvos.

Esta versão inclui uma função proxy em `functions/api/proxy.js`, limitada aos domínios oficiais do TJCE/DJEA, e encaminha as requisições dos módulos para ela. Isso elimina a necessidade de CORS no navegador, mas ainda precisa ser testado no ambiente real do Cloudflare Pages; o proxy não transmite cookies de sessão do usuário e não contorna autenticação exigida pelo TJCE. A atualização periódica só será executada enquanto a página estiver aberta; o navegador pode suspender abas em segundo plano, portanto não há garantia de execução pontual.

## Publicação

Publique a pasta `feriados-tjce` como diretório raiz do projeto no Cloudflare Pages, mantendo a pasta `functions/` na raiz. O endpoint `/api/proxy` é necessário para as consultas externas.

Não publique como ferramenta final até concluir o proxy e os testes funcionais de:
1. busca incremental e completa no DJEA via proxy;
2. leitura automática dos registros `.eventos_calendario` do TJCE via proxy;
3. armazenamento local, exportação/importação de dados;
4. cálculos CPC e CPP comparados a casos de referência;
5. uso em Chrome e Edge.

Os dados são locais neste navegador. Limpar dados do site ou usar outro perfil/dispositivo pode removê-los/não os compartilhar.


## Atualização de persistência web (IndexedDB)
A versão web usa IndexedDB para armazenar dados localmente por navegador/perfil, inclusive registros maiores de calendário e cadastro de juízes. O arquivo `index.html` é a entrada padrão do Cloudflare Pages. Ao atualizar o projeto, publique os arquivos da pasta `feriados-tjce` na raiz do repositório, substituindo os arquivos existentes.
