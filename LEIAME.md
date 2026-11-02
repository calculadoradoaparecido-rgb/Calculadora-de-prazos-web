# Prazos CPC e Feriados Municipais — TJCE Cariri (v2)

Extensão Chrome/Edge com duas abas.

**Calculadora** — prazo pelo CPC/2015 para as 17 comarcas de trabalho (e municípios vinculados), usando:
- calendário-base: feriados nacionais, São José (19/3), Data Magna do Ceará, Carnaval, Semana Santa, Corpus Christi,
  Dia do Servidor (28/10), Dia da Justiça (8/12) e recesso (20/12 a 6/1);
- suspensão de prazos de 20/12 a 20/1 (art. 220);
- feriados municipais e pontos facultativos lidos das portarias do DJEA;
- datas informadas à mão (ex.: indisponibilidade do PJe).

Regras: dias úteis (art. 219); publicação no 1º dia útil após a disponibilização (art. 224, § 2º);
contagem a partir do dia útil seguinte (art. 224, § 3º); começo e vencimento prorrogados se caírem em
dia sem expediente ou com expediente reduzido (art. 224, § 1º); ciência tácita 10 dias corridos após o
envio pelo sistema (Lei 11.419/2006, art. 5º, § 3º); prazo em dobro opcional (arts. 180, 183 e 186).

**Criminal (CPP)** — prazo penal com os mesmos feriados e portarias:
- prazo contínuo: fins de semana, feriados e pontos facultativos no meio do prazo contam (CPP, art. 798);
- não se conta o dia da intimação; a contagem começa no primeiro dia útil seguinte (art. 798, § 1º; Súmula 310 do STF);
- corre da intimação, e não da juntada do mandado (Súmula 710 do STF);
- vencimento em dia sem expediente, ou com expediente encerrado antes, passa para o dia útil seguinte (art. 798, § 3º);
- suspensão de 20/12 a 20/01 (art. 798-A), salvo réu preso, Lei Maria da Penha ou medida urgente (opção no formulário);
- prazo em dobro só para a Defensoria Pública (o MP não tem prazo em dobro no processo penal);
- portarias que suspendem prazos também valem; as que só fecham o fórum não interrompem a contagem.

**Feriados e coleta** — mostra também os feriados nacionais e estaduais do calendário-base.
A coleta pesquisa os atos do ano escolhido e também os do ano anterior, porque o calendário
anual do TJCE é publicado em dezembro (o de 2026 é a Portaria nº 2924/2025).
Antes: a coleta no DJEA da versão anterior, mostrando só as comarcas de trabalho
e seus vinculados. A lista de comarcas fica em `comarcas.js`.

## Calendário Eletrônico do TJCE
Em Feriados e coleta > Calendário Eletrônico do TJCE > "Importar do calendário".
O calendário do TJCE usa FullCalendar e traz os eventos dentro da própria página. A extensão abre o
calendário numa aba em segundo plano, pede os eventos ao próprio calendário mês a mês e fecha a aba
(cerca de 10 segundos). A busca diária automática faz o mesmo. Entram só datas das comarcas de trabalho
e de todo o Estado; quando o DJEA traz a mesma data para o mesmo município, vale o ato do DJEA.
Se nada for importado, use "Copiar diagnóstico" e envie o texto para ajuste.

## Juízes (aba Juízes)
Inclui as unidades criminais (varas criminais de Crato e Juazeiro, Vara Única Criminal de Barbalha e de Brejo Santo,
Juizados da Violência Doméstica, Juizados Especiais e Núcleo de Custódia). O filtro "Área" separa cível e criminal
(varas únicas e juizados especiais aparecem nos dois). Quando a unidade não tem titular cadastrado e o DJEA traz o
titular, aparece o botão "Usar" (ou "Preencher N titulares com o DJEA" para todos).
Tabela por unidade, no formato da planilha da equipe: Titular, Situação (em exercício, afastado,
sem titular, afastamento previsto) e quem Responde. Clique em "Editar" na linha para alterar;
o período aceita "14/09 a 03/10", "Até 28/02/2027" ou "Tempo indeterminado" (vazio = em exercício).
A coluna "Conferência DJEA" compara cada linha com as portarias lidas:
- Confere: o DJEA traz a mesma designação (ou o mesmo titular);
- divergência (amarelo): o DJEA indica outro substituto, outro titular ou um afastamento não cadastrado;
- "Nenhum ato lido": o cadastro indica afastamento, mas nenhuma portaria correspondente foi coletada.
A lista completa das designações lidas fica em "Designações lidas no DJEA".
Lê os dois formatos de portaria: texto corrido ("designar o Juiz X para responder pela Vara Y…") e
tabela da Presidência ("designar os(as) magistrados(as) constantes da relação abaixo…", com colunas
Período | Comarca | Titular/Respondendo | Designado). Na tabela, as colunas são achadas pelo cabeçalho
(aceita Início e Fim separados), período partido ("08/10 a 22/10/26 e 27/10 a 31/10/26") vira dois
eventos e "Titular da …" na coluna do designado registra a lotação dele. Só entram as linhas das comarcas de trabalho.
Na versão 2.17, as matérias que a versão anterior tinha descartado são relidas uma vez, na próxima atualização.
A conferência também olha designações futuras: afastamento "previsto" no cadastro é comparado com a
portaria que cobre o período, e uma designação futura não cadastrada aparece como "DJEA (previsto)".
Para conferir um ato isolado: Feriados e coleta > Analisar uma matéria (mostra também as designações de juízes).

## Compartilhar com os dados
Em Feriados e coleta > Dados salvos > Compartilhar:
- "Exportar extensão com dados" gera um .zip com a extensão e o arquivo dados-iniciais.json.
  Quem recebe descompacta, carrega a pasta em chrome://extensions (Modo do desenvolvedor >
  Carregar sem compactação) e a extensão já abre com tudo.
- "Exportar dados (.json)" / "Importar dados": para quem já tem a extensão.
Ao importar, os atos do DJEA são somados aos existentes e o cadastro de juízes mais recente prevalece.

## Atualização diária e carga completa
- "Atualizar agora" e a atualização diária automática buscam só o que saiu desde a última atualização:
  no DJEA, cada pesquisa para na primeira página que só tem atos já lidos (resultados do mais recente
  para o mais antigo) e pesquisa os anos desde o da última atualização; no calendário do TJCE, a
  varredura começa no mês da última atualização. Se ficar dias sem rodar, a próxima cobre todo o período.
- A "última atualização" só avança quando a rodada termina bem (sem pesquisa com falha e com o calendário
  respondendo); senão, a próxima retroage a partir da anterior.
- "Carga completa (refaz tudo)" percorre todas as páginas de todas as pesquisas (ano atual e anterior)
  e o calendário do ano inteiro. Só roda quando você clicar.

## Atualizar
Substitua os arquivos da pasta da extensão e clique em recarregar em `chrome://extensions`.
Assim os dados já coletados continuam salvos.
