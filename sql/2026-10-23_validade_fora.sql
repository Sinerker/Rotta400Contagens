-- 2026-10-23 · a conferência de validade saiu do fluxo de contagem
--
-- Ela vai virar um fluxo próprio, que não depende de inventário. Este arquivo
-- é a parte do banco. Antes de rodar, as 567 datas vivas foram exportadas para
-- "Claude outputs/Validades coletadas - Rotta400.xlsx".
--
-- PARTE 1 — rodada em 23/10/2026, logo depois de publicar o app v20.
-- Nada aqui quebra coletor com código velho na tela.

-- pacote_lote deixa de mandar confere_validade: o coletor velho recebe
-- undefined, VAL() vira false e ele também para de pedir a data na hora.
create or replace function public.pacote_lote(p_lote uuid)
 returns json language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select json_build_object(
    'lote', json_build_object('id', l.id, 'nome', l.nome, 'status', l.status, 'retrato_em', l.retrato_em,
                              'regras', l.regras, 'origem_id', l.origem_id),
    'itens', (
      select coalesce(json_agg(json_build_object(
               'seq', i.seqproduto, 'desc', i.descricao, 'qtd', i.qtd_sistema,
               'eans', (select coalesce(json_agg(json_build_object('ean', c.ean, 'emb', c.qtd_embalagem, 'sig', c.embalagem)), '[]'::json)
                        from cadastro c where c.seqproduto = i.seqproduto)
             ) order by i.descricao), '[]'::json)
      from lote_item i where i.lote_id = l.id))
  from lote l
  where l.id = p_lote and (l.loja_id = private.app_loja_id() or private.app_eh_auditor());
$function$;

update contagem set validade = null where validade is not null;   -- 567 linhas
update loja  set confere_validade = false where confere_validade; -- a 303
update lote  set confere_validade = false where confere_validade; -- 7 inventários

-- PARTE 2 — as colunas em si. SEGURADA até nenhum coletor estar com o código
-- velho na tela. Um app velho manda "validade" no POST de contagem e
-- "confere_validade" ao criar inventário; sem a coluna, os dois dão 400:
-- a contagem fica presa no aparelho e o inventário novo não nasce.
-- Rodar num horário sem ninguém contando.
--
-- alter table contagem drop column validade;
-- alter table lote     drop column confere_validade;
-- alter table loja     drop column confere_validade;
--
-- contagem.grupo_id FICA: os lançamentos antigos da 303 têm várias linhas com
-- o mesmo grupo, e o "Já contei" ainda junta por grupo_id para mostrar cada um
-- como um lançamento só.
