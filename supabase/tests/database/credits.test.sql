-- pgTAP proof of the access and credit rules. Run with `supabase test db`
-- (needs Docker), or against an isolated database with:
--   psql -f supabase/tests/database/credits.test.sql
-- The whole file runs inside one transaction and rolls back; it writes nothing
-- permanent and must never be pointed at a production project.
begin;
create extension if not exists pgtap;
select plan(15);

-- Fixtures ------------------------------------------------------------------
-- Two users. The on_auth_user_created trigger is what creates their profiles,
-- so test 1 doubles as a check that the trigger fired.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','a@example.test','x',now(),now()),
 ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated','b@example.test','x',now(),now());

select is(
 (select count(*)::int from public.profiles
  where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
 2, 'auth.users insert creates a profile for each user');

select public.record_consent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, true);
select public.record_consent('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true, true);

insert into public.scenes (id, slug, titulo, descricao, categoria, capa_path, duracao_s, engine, preco_creditos, ativo)
values
 ('11111111-1111-4111-8111-111111111111','cena-ativa','Cena ativa','Exemplo.','Humor','examples/a.svg',6,'demo',10,true),
 ('22222222-2222-4222-8222-222222222222','cena-inativa','Cena inativa','Exemplo.','Humor','examples/b.svg',6,'demo',10,false);

insert into public.characters (id, user_id, nome, imagem_path) values
 ('a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Personagem A','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.png'),
 ('b1111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Personagem B','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b.png');

insert into public.generations (id, user_id, scene_id, character_id, provider) values
 ('a2222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','demo'),
 ('b2222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','demo');

-- B has a ledger row so that "A cannot read it" is a real negative, not an
-- empty table trivially returning zero.
insert into public.credit_ledger (user_id, delta, motivo, idempotency_key)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 50, 'test_seed', 'test_seed:b');
-- A starts with 4 credits: less than the scene's price of 10.
insert into public.credit_ledger (user_id, delta, motivo, idempotency_key)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 4, 'test_seed', 'test_seed:a');

-- User A cannot read user B's data -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);

select is((select count(*)::int from public.characters), 1,
 'A sees only its own character');
select is((select count(*)::int from public.generations), 1,
 'A sees only its own generation');
select is((select count(*)::int from public.credit_ledger), 1,
 'A sees only its own ledger rows');
select is(public.credit_balance(), 4::bigint,
 'credit_balance returns A''s own balance, not B''s');
select is((select count(*)::int from public.scenes), 1,
 'only active scenes are readable');

-- A cannot credit itself, directly or through the reservation RPC ----------
select throws_ok($$
 insert into public.credit_ledger (user_id, delta, motivo, idempotency_key)
 values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1000, 'hack', 'hack:a')
$$, '42501', null, 'authenticated cannot insert credit for itself');

select throws_ok($$
 update public.credit_ledger set delta = 1000
$$, '42501', null, 'authenticated cannot edit its own ledger rows');

select throws_ok($$
 select public.reserve_credits('a2222222-2222-4222-8222-222222222222')
$$, '42501', null, 'authenticated cannot execute reserve_credits');

reset role;
select set_config('request.jwt.claims', '', true);

-- Reservation ---------------------------------------------------------------
select throws_ok($$
 select public.reserve_credits('a2222222-2222-4222-8222-222222222222')
$$, 'P0001', 'Insufficient credits', 'reservation fails when the balance is short');

insert into public.credit_ledger (user_id, delta, motivo, idempotency_key)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 16, 'test_topup', 'test_topup:a');

select is(public.reserve_credits('a2222222-2222-4222-8222-222222222222'), 10::bigint,
 'reservation debits the scene price and returns the new balance');

-- Called twice (a retry, a double submit), it must not debit twice.
select public.reserve_credits('a2222222-2222-4222-8222-222222222222');
select is(
 (select count(*)::int from public.credit_ledger
  where idempotency_key = 'reserve:a2222222-2222-4222-8222-222222222222'),
 1, 'a repeated reservation debits only once');

-- Refund --------------------------------------------------------------------
select throws_ok($$
 select public.refund_credits('a2222222-2222-4222-8222-222222222222')
$$, 'P0001', 'Only failed generations can be refunded',
 'a generation that has not failed cannot be refunded');

update public.generations set status = 'failed'
 where id = 'a2222222-2222-4222-8222-222222222222';
select public.refund_credits('a2222222-2222-4222-8222-222222222222');
select public.refund_credits('a2222222-2222-4222-8222-222222222222');
select is(
 (select coalesce(sum(delta),0)::int from public.credit_ledger
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 20, 'a failed generation is refunded exactly once');

-- Append-only ledger, including for the owner running these tests -----------
select throws_ok($$
 delete from public.credit_ledger
  where idempotency_key = 'reserve:a2222222-2222-4222-8222-222222222222'
$$, '23001', null, 'ledger rows cannot be deleted');

select * from finish();
rollback;
