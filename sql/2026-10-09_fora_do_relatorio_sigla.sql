-- =============================================================
-- 1) Excluir inventário vazio: vale para aberto também
-- =============================================================
create or replace function public.excluir_lote_vazio(p_lote uuid)
returns text language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_lote record;
begin
  select l.id, l.loja_id, l.status into v_lote from lote l where l.id = p_lote for update;
  if v_lote.id is null then raise exception 'Inventário não encontrado'; end if;
  if not private.app_eh_auditor() and v_lote.loja_id is distinct from private.app_loja_id() then
    raise exception 'Inventário de outra loja';
  end if;
  if exists (select 1 from contagem c where c.lote_id = p_lote) then
    raise exception 'Este inventário tem contagens — feche e use a exclusão com motivo';
  end if;
  delete from lote where id = p_lote;
  return 'excluido';
end $fn$;

-- =============================================================
-- 2) Sigla da embalagem (UN, CX, PC...) na sincronização do cadastro
-- =============================================================
create or replace function public.cadastro_sinc_receber(p_linhas jsonb)
returns integer language plpgsql security definer set search_path to 'public', 'pg_temp'
set statement_timeout to '60s'
as $fn$
declare v_qtd integer;
begin
  if not private.app_eh_auditor() then raise exception 'Somente o auditor atualiza o cadastro'; end if;
  insert into stage_cadastro (seqproduto, ean, descricao, qtd_embalagem, categoria, embalagem)
  select nullif(trim(x->>'seqproduto'), ''), nullif(trim(x->>'ean'), ''), nullif(trim(x->>'descricao'), ''),
         coalesce(nullif(x->>'qtd_embalagem','')::numeric, 1), nullif(trim(x->>'categoria'), ''),
         nullif(upper(trim(x->>'embalagem')), '')
    from jsonb_array_elements(p_linhas) x;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $fn$;

create or replace function public.cadastro_sinc_aplicar(p_total integer, p_origem timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
set statement_timeout to '120s'
as $fn$
declare v_espera integer; v_antes integer; v_linhas integer; v_prods integer;
begin
  if not private.app_eh_auditor() then raise exception 'Somente o auditor atualiza o cadastro'; end if;
  select count(*) into v_espera from stage_cadastro where ean is not null and seqproduto is not null;
  select count(*) into v_antes  from cadastro;
  if p_total is not null and v_espera <> p_total then
    raise exception 'Chegou cadastro incompleto: recebi % linhas válidas, o Contagens tem %. Nada foi trocado.', v_espera, p_total;
  end if;
  if v_espera = 0 then raise exception 'Não chegou nenhuma linha. Nada foi trocado.'; end if;
  if v_antes > 0 and v_espera < v_antes / 2 then
    raise exception 'O cadastro novo tem % linhas contra % do atual — menos da metade. Parece transferência cortada. Nada foi trocado.', v_espera, v_antes;
  end if;
  truncate table cadastro;
  insert into cadastro (seqproduto, ean, descricao, qtd_embalagem, categoria, embalagem)
  select distinct on (ean, seqproduto) seqproduto, ean, coalesce(descricao, ''), coalesce(qtd_embalagem, 1), categoria, embalagem
    from stage_cadastro where ean is not null and seqproduto is not null
   order by ean, seqproduto;
  get diagnostics v_linhas = row_count;
  select count(distinct seqproduto) into v_prods from cadastro;
  insert into cadastro_carga (linhas, origem_em) values (v_linhas, p_origem);
  truncate table stage_cadastro;
  return jsonb_build_object('linhas', v_linhas, 'produtos', v_prods, 'antes', v_antes);
end $fn$;

-- =============================================================
-- 3) Pacote do coletor: sigla da embalagem e origem (recontagem)
-- =============================================================
create or replace function public.pacote_lote(p_lote uuid)
returns json language sql stable security definer set search_path to 'public', 'pg_temp'
as $fn$
  select json_build_object(
    'lote', json_build_object('id', l.id, 'nome', l.nome, 'status', l.status, 'retrato_em', l.retrato_em,
                              'regras', l.regras, 'confere_validade', l.confere_validade, 'origem_id', l.origem_id),
    'itens', (
      select coalesce(json_agg(json_build_object(
               'seq', i.seqproduto, 'desc', i.descricao, 'qtd', i.qtd_sistema,
               'eans', (select coalesce(json_agg(json_build_object('ean', c.ean, 'emb', c.qtd_embalagem, 'sig', c.embalagem)), '[]'::json)
                        from cadastro c where c.seqproduto = i.seqproduto)
             ) order by i.descricao), '[]'::json)
      from lote_item i where i.lote_id = l.id))
  from lote l
  where l.id = p_lote and (l.loja_id = private.app_loja_id() or private.app_eh_auditor());
$fn$;

-- =============================================================
-- 4) Produto com cadastro mas fora do relatório: pode contar
--    (menos na recontagem, que continua só com os escolhidos)
-- =============================================================
drop policy if exists contagem_criar on public.contagem;
create policy contagem_criar on public.contagem for insert to authenticated
with check (
  exists (select 1 from lote l where l.id = contagem.lote_id and l.status = 'aberto'
          and (l.loja_id = private.app_loja_id() or private.app_eh_auditor()))
  and seqproduto is not null
  and (
    exists (select 1 from lote_item i where i.lote_id = contagem.lote_id and i.seqproduto = contagem.seqproduto)
    or (exists (select 1 from cadastro c where c.seqproduto = contagem.seqproduto)
        and exists (select 1 from lote l where l.id = contagem.lote_id and l.origem_id is null))
  ));

drop policy if exists contagem_atualizar on public.contagem;
create policy contagem_atualizar on public.contagem for update to authenticated
using (
  exists (select 1 from lote l where l.id = contagem.lote_id and l.status = 'aberto'
          and (l.loja_id = private.app_loja_id() or private.app_eh_auditor())))
with check (
  exists (select 1 from lote l where l.id = contagem.lote_id and l.status = 'aberto'
          and (l.loja_id = private.app_loja_id() or private.app_eh_auditor()))
  and seqproduto is not null
  and (
    exists (select 1 from lote_item i where i.lote_id = contagem.lote_id and i.seqproduto = contagem.seqproduto)
    or (exists (select 1 from cadastro c where c.seqproduto = contagem.seqproduto)
        and exists (select 1 from lote l where l.id = contagem.lote_id and l.origem_id is null))
  ));

-- Divergência: produto fora do relatório que existe no cadastro vira SOBRA
-- (sistema 0), com o nome do cadastro e a marca "FORA DO RELATÓRIO".
create or replace function public.divergencia_lote(p_lote uuid)
returns table(seqproduto text, descricao text, qtd_sistema numeric, qtd_contada numeric, diferenca numeric, situacao text)
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_status text; v_loja uuid;
begin
  select l.status, l.loja_id into v_status, v_loja from lote l where l.id = p_lote;
  if v_status is null then raise exception 'Lote não encontrado'; end if;
  if not private.app_eh_auditor() then
    if v_loja is distinct from private.app_loja_id() then raise exception 'Lote de outra loja'; end if;
    if v_status <> 'fechado' then raise exception 'Feche o lote para ver as divergências'; end if;
  end if;

  return query
  with viva as (
    select c.* from contagem c
    where c.lote_id = p_lote and c.cancela_id is null
      and not exists (select 1 from contagem x where x.lote_id = p_lote and x.cancela_id = c.id)
  ),
  contado as (
    select coalesce(v.seqproduto, 'ean:' || v.ean_lido) as chave, v.seqproduto as seq,
           max(v.ean_lido) as ean, sum(v.quantidade * v.qtd_embalagem) as unidades
    from viva v group by 1, 2
  )
  select i.seqproduto, i.descricao, i.qtd_sistema,
         coalesce(ct.unidades, 0), coalesce(ct.unidades, 0) - i.qtd_sistema,
         case when ct.unidades is null         then 'nao_conferido'
              when ct.unidades > i.qtd_sistema then 'sobra'
              when ct.unidades < i.qtd_sistema then 'falta'
              else 'ok' end
  from lote_item i left join contado ct on ct.seq = i.seqproduto
  where i.lote_id = p_lote

  union all

  select ct.seq,
         coalesce((select max(c.descricao) from cadastro c where c.seqproduto = ct.seq) || ' · FORA DO RELATÓRIO',
                  'NÃO CADASTRADO NO LOTE — EAN ' || coalesce(ct.ean, '?')),
         case when exists (select 1 from cadastro c where c.seqproduto = ct.seq) then 0::numeric end,
         ct.unidades, ct.unidades,
         case when exists (select 1 from cadastro c where c.seqproduto = ct.seq)
              then case when ct.unidades > 0 then 'sobra' else 'ok' end
              else 'nao_cadastrado' end
  from contado ct
  where ct.seq is null
     or not exists (select 1 from lote_item i where i.lote_id = p_lote and i.seqproduto = ct.seq);
end $fn$;
