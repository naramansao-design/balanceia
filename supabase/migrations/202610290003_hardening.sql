-- Offline migration. Apply and test in a separate Supabase project.
-- Closes three gaps found in the audit of 202610290001:
--  1. credit_ledger could be rewritten by the service role.
--  2. No profile could ever exist, because nothing created one from auth.users.
--  3. Consent timestamps had no server-side write path, so reserve_credits
--     could never pass its own consent check.

-- 1. Append-only ledger. The trigger is ENABLE ALWAYS so it also fires for the
-- table owner and under session_replication_role = replica; corrections are
-- made by inserting a compensating row, never by editing history.
create function public.deny_ledger_mutation() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 raise exception 'credit_ledger is append-only (attempted %)', tg_op
  using errcode='restrict_violation';
end;$$;
revoke all on function public.deny_ledger_mutation() from public,anon,authenticated;
create trigger credit_ledger_append_only
 before update or delete on public.credit_ledger
 for each row execute function public.deny_ledger_mutation();
alter table public.credit_ledger enable always trigger credit_ledger_append_only;

-- Truncate bypasses row triggers entirely, so it gets its own statement trigger.
create trigger credit_ledger_no_truncate
 before truncate on public.credit_ledger
 for each statement execute function public.deny_ledger_mutation();
alter table public.credit_ledger enable always trigger credit_ledger_no_truncate;

-- 2. A profile row for every authenticated user. Name and consent stay empty:
-- consent is recorded only by the explicit RPC below, with server time.
create function public.handle_new_user() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id) values (new.id) on conflict (id) do nothing;
 return new;
end;$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
create trigger on_auth_user_created after insert on auth.users
 for each row execute function public.handle_new_user();

-- 3. Consent recorded server-side. The browser sends only booleans; the
-- timestamps come from the database clock and are never cleared by this path,
-- so an acceptance cannot be silently backdated or withdrawn to dodge an audit.
create function public.record_consent(p_user_id uuid, p_terms boolean, p_adult boolean)
 returns public.profiles language plpgsql security definer set search_path='' as $$
declare updated public.profiles;
begin
 if p_user_id is null then raise exception 'User required'; end if;
 update public.profiles set
  aceitou_termos_em = case when p_terms then coalesce(aceitou_termos_em, now()) else aceitou_termos_em end,
  maior_de_idade_confirmado_em = case when p_adult then coalesce(maior_de_idade_confirmado_em, now()) else maior_de_idade_confirmado_em end
 where id = p_user_id returning * into updated;
 if not found then raise exception 'Profile not found'; end if;
 return updated;
end;$$;
revoke all on function public.record_consent(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_consent(uuid,boolean,boolean) to service_role;
