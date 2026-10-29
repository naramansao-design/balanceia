-- Offline migration. Apply and test in a separate Supabase project.
create extension if not exists pgcrypto;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 nome text not null default '', aceitou_termos_em timestamptz,
 maior_de_idade_confirmado_em timestamptz
);
create table public.scenes (
 id uuid primary key default gen_random_uuid(), slug text unique not null,
 titulo text not null, descricao text not null,
 categoria text not null check (categoria in ('Em alta','Humor','Luxo & viagens')),
 capa_path text not null, reference_video_path text,
 duracao_s integer not null check (duracao_s > 0), engine text not null,
 engine_params jsonb not null default '{}', preco_creditos integer not null check (preco_creditos > 0),
 ativo boolean not null default false
);
create table public.characters (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 nome text not null check (length(nome) between 1 and 80), imagem_path text not null,
 autorizacao_em timestamptz not null default now(), deleted_at timestamptz,
 unique (id,user_id), check (split_part(imagem_path,'/',1) = user_id::text)
);
create table public.generations (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 scene_id uuid not null references public.scenes(id), character_id uuid not null,
 status text not null default 'waiting' check (status in ('waiting','processing','completed','failed')),
 provider text not null, provider_request_id text, custo_estimado_usd numeric check (custo_estimado_usd >= 0),
 custo_real_usd numeric check (custo_real_usd >= 0),creditos_cobrados integer not null default 0 check (creditos_cobrados>=0),
 tentativas integer not null default 0 check (tentativas>=0), erro text, resultado_path text,
 visibilidade text not null default 'private' check (visibilidade='private'),criado_em timestamptz not null default now(),
 foreign key (character_id,user_id) references public.characters(id,user_id), unique(id,user_id)
);
create table public.credit_ledger (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 delta integer not null check(delta<>0),motivo text not null,
 generation_id uuid,idempotency_key text not null unique,criado_em timestamptz not null default now(),
 foreign key (generation_id,user_id) references public.generations(id,user_id)
);
create index characters_owner on public.characters(user_id);
create index generations_owner on public.generations(user_id,criado_em desc);
create index credit_ledger_owner on public.credit_ledger(user_id);
alter table public.profiles enable row level security;
alter table public.scenes enable row level security;
alter table public.characters enable row level security;
alter table public.generations enable row level security;
alter table public.credit_ledger enable row level security;
revoke all on public.profiles,public.scenes,public.characters,public.generations,public.credit_ledger from anon,authenticated;
grant select on public.scenes to anon,authenticated;
grant select on public.profiles,public.characters,public.generations,public.credit_ledger to authenticated;
-- User writes are deliberately server-only; no ownership or consent timestamps supplied by client.
grant all on public.profiles,public.scenes,public.characters,public.generations,public.credit_ledger to service_role;
create policy active_scenes on public.scenes for select to anon,authenticated using (ativo);
create policy own_profile on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy own_characters on public.characters for select to authenticated using ((select auth.uid())=user_id and deleted_at is null);
create policy own_generations on public.generations for select to authenticated using ((select auth.uid())=user_id);
create policy own_ledger on public.credit_ledger for select to authenticated using ((select auth.uid())=user_id);
create function public.credit_balance() returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(delta),0)::bigint from public.credit_ledger where user_id=auth.uid();
$$;
revoke all on function public.credit_balance() from public,anon;
grant execute on function public.credit_balance() to authenticated;
-- Lock the owner's profile for serialization, including when no ledger rows exist yet.
-- Derive price and owner from generation; never accept price, delta or owner from the browser.
create function public.reserve_credits(p_generation_id uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare g public.generations; amount integer; balance bigint; existing public.credit_ledger;
begin
 select * into g from public.generations where id=p_generation_id;
 if not found then raise exception 'Generation not found'; end if;
 perform 1 from public.profiles where id=g.user_id for update;
 select * into g from public.generations where id=p_generation_id for update;
 select * into existing from public.credit_ledger where idempotency_key='reserve:'||g.id;
 if found then return (select coalesce(sum(delta),0) from public.credit_ledger where user_id=g.user_id); end if;
 if g.status<>'waiting' then raise exception 'Generation is not waiting'; end if;
 if not exists(select 1 from public.profiles where id=g.user_id and aceitou_termos_em is not null and maior_de_idade_confirmado_em is not null) then raise exception 'Adult consent and terms required'; end if;
 if not exists(select 1 from public.characters where id=g.character_id and user_id=g.user_id and deleted_at is null) then raise exception 'Character unavailable'; end if;
 select preco_creditos into amount from public.scenes where id=g.scene_id and ativo;
 if not found then raise exception 'Scene unavailable'; end if;
 select coalesce(sum(delta),0) into balance from public.credit_ledger where user_id=g.user_id;
 if balance<amount then raise exception 'Insufficient credits'; end if;
 insert into public.credit_ledger(user_id,delta,motivo,generation_id,idempotency_key) values(g.user_id,-amount,'generation_reservation',g.id,'reserve:'||g.id);
 update public.generations set creditos_cobrados=amount where id=g.id;
 return balance-amount;
end;$$;
create function public.refund_credits(p_generation_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare g public.generations; amount integer;
begin
 select * into g from public.generations where id=p_generation_id;
 if not found then raise exception 'Generation not found'; end if;
 perform 1 from public.profiles where id=g.user_id for update;
 select * into g from public.generations where id=p_generation_id for update;
 if g.status<>'failed' then raise exception 'Only failed generations can be refunded'; end if;
 select -delta into amount from public.credit_ledger where generation_id=g.id and idempotency_key='reserve:'||g.id;
 if amount is null then raise exception 'No reservation'; end if;
 insert into public.credit_ledger(user_id,delta,motivo,generation_id,idempotency_key)
 values(g.user_id,amount,'generation_refund',g.id,'refund:'||g.id) on conflict (idempotency_key) do nothing;
end;$$;
revoke all on function public.reserve_credits(uuid),public.refund_credits(uuid) from public,anon,authenticated;
grant execute on function public.reserve_credits(uuid),public.refund_credits(uuid) to service_role;
-- Private buckets; no anonymous policies and no direct upload grants.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('characters','characters',false,8388608,array['image/jpeg','image/png','image/webp']),
 ('generations','generations',false,null,array['video/mp4']),
 ('scenes','scenes',false,null,array['image/jpeg','image/png','image/webp','video/mp4'])
 on conflict(id) do nothing;
-- Signed URL creation must stay server-side, with an authenticated owner check and a 60s TTL.
-- No storage SELECT policy: even authenticated users cannot mint their own unrestricted signed URLs.
