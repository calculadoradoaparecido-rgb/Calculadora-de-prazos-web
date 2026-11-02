# Versão web — Prazos CPC/CPP e Feriados TJCE

## O que esta adaptação já faz
- Mantém a interface e os módulos de cálculo da extensão.
- Usa armazenamento local do navegador (`localStorage`) em vez de `chrome.storage`.
- Os dados permanecem separados por servidor e por navegador/perfil.
- Links externos abrem em nova aba.

## Limitação importante antes de publicar para uso real
A coleta automática no DJEA e no calendário do TJCE não pode ser considerada funcional em um site estático sem testes adicionais: navegadores aplicam CORS a requisições cross-origin, enquanto a extensão tinha permissões de host. A busca no DJEA foi preservada no fluxo da página e a leitura do calendário agora tenta descobrir os dados diretamente via proxy. Recursos que dependem de background/offscreen e de varrer uma aba visual do calendário continuam indisponíveis na web; a extração automática do calendário depende da estrutura que o TJCE publicar e precisa ser validada em produção.

Esta versão inclui uma função proxy em `functions/api/proxy.js`, limitada aos domínios oficiais do TJCE/DJEA, e encaminha as requisições dos módulos para ela. Isso elimina a necessidade de CORS no navegador, mas ainda precisa ser testado no ambiente real do Cloudflare Pages; o proxy não transmite cookies de sessão do usuário e não contorna autenticação exigida pelo TJCE. A atualização periódica só será executada enquanto a página estiver aberta; o navegador pode suspender abas em segundo plano, portanto não há garantia de execução pontual.

## Publicação

Publique a pasta `feriados-tjce` como diretório raiz do projeto no Cloudflare Pages, mantendo a pasta `functions/` na raiz. O endpoint `/api/proxy` é necessário para as consultas externas.

Não publique como ferramenta final até concluir o proxy e os testes funcionais de:
1. busca incremental e completa no DJEA via proxy;
2. leitura automática do calendário TJCE via proxy (incluindo cenários em que os eventos só aparecem na interface visual);
3. armazenamento local, exportação/importação de dados;
4. cálculos CPC e CPP comparados a casos de referência;
5. uso em Chrome e Edge.

Os dados são locais neste navegador. Limpar dados do site ou usar outro perfil/dispositivo pode removê-los/não os compartilhar.
