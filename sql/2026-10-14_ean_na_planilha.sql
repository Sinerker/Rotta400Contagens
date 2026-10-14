-- 2026-10-14 · EAN nas planilhas do fechamento
--
-- A coluna "Código" é o SEQPRODUTO do Consinco. O auditor também precisa do
-- EAN para procurar o produto em outros sistemas, então as planilhas de
-- divergência e de validade ganharam uma coluna EAN.
--
-- Regra: UM EAN por produto CONTADO, nesta ordem de preferência:
--   1) o EAN que foi bipado, se ele for o unitário (embalagem 1);
--   2) o EAN unitário do cadastro — foi bipado o fardo, a planilha mostra a unidade;
--   3) o de menor embalagem, para produto sem linha unitária (25 em 133 mil);
--   4) o bipado puro, quando o produto não está no cadastro.
--
-- Produto NÃO contado não entra na lista: a célula fica vazia de propósito,
-- para a planilha separar o que foi coletado do que não foi.
--
-- Contagem feita por NOME já grava o EAN unitário em contagem.ean_lido
-- (contar.js, função procurar), então o caso "contei pelo nome" cai na regra 1.
--
-- Nada foi alterado em divergencia_lote nem em nenhuma tabela: é função nova.
-- A trava de loja é a mesma da divergencia_lote.

create or replace function public.ean_do_lote(p_lote uuid)
returns table(seqproduto text, ean text)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_status text; v_loja uuid;
begin
  select l.status, l.loja_id into v_status, v_loja from lote l where l.id = p_lote;
  if v_status is null then raise exception 'Lote não encontrado'; end if;
  if not private.app_eh_auditor() then
    if v_loja is distinct from private.app_loja_id() then raise exception 'Lote de outra loja'; end if;
  end if;

  return query
  with viva as (
    select c.* from contagem c
    where c.lote_id = p_lote and c.cancela_id is null
      and not exists (select 1 from contagem x where x.lote_id = p_lote and x.cancela_id = c.id)
  ),
  contados as (
    select v.seqproduto as seq,
           (array_agg(v.ean_lido order by v.criado_em, v.id)
            filter (where v.ean_lido is not null))[1] as bipado
    from viva v
    where v.seqproduto is not null
    group by 1
  )
  select ct.seq,
         coalesce(
           (select c.ean from cadastro c
             where c.seqproduto = ct.seq and c.ean = ct.bipado and c.qtd_embalagem = 1 limit 1),
           (select min(c.ean) from cadastro c
             where c.seqproduto = ct.seq and c.qtd_embalagem = 1),
           (select c.ean from cadastro c
             where c.seqproduto = ct.seq and c.ean is not null
             order by c.qtd_embalagem nulls last, c.ean limit 1),
           ct.bipado)
  from contados ct;
end $fn$;

-- função nasce com EXECUTE para PUBLIC e para anon: tira os dois
revoke all on function public.ean_do_lote(uuid) from public;
revoke execute on function public.ean_do_lote(uuid) from anon;
grant execute on function public.ean_do_lote(uuid) to authenticated;
