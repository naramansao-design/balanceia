-- Enforce submission idempotency in the future repository adapter.
alter table public.generations add column idempotency_key text;
create unique index generation_submission_idempotency on public.generations(user_id,idempotency_key) where idempotency_key is not null;
