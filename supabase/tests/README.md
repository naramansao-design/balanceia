# Testes de banco

**Nada aqui foi executado.** Não há Docker, Supabase CLI nem `psql` nesta
máquina, então os testes estão escritos mas não verificados. Rode-os num banco
isolado antes de confiar em qualquer afirmação de segurança.

## Automático (pgTAP)

```sh
supabase start
supabase test db
```

Ou, contra um banco isolado já com as migrations aplicadas:

```sh
psql "$DATABASE_URL" -f supabase/tests/database/credits.test.sql
```

`database/credits.test.sql` roda em uma transação e faz `rollback` no fim.
São 15 asserções cobrindo: criação automática de perfil, isolamento de
`characters`/`generations`/`credit_ledger` entre dois usuários, saldo próprio,
visibilidade só de cenas ativas, impossibilidade de o cliente creditar ou
editar o próprio ledger, impossibilidade de o cliente executar
`reserve_credits`, falha com saldo insuficiente, débito idempotente, recusa de
estorno em geração não falhada, estorno único e ledger imutável.

## Manual: concorrência em `reserve_credits`

Isto exige duas conexões simultâneas, o que um arquivo SQL em transação única
não consegue expressar. Com um perfil que tenha **10 créditos** e duas gerações
`waiting` dele (`G1` e `G2`) numa cena de preço 10:

Terminal 1:

```sql
begin;
select public.reserve_credits('G1');
-- não finalize ainda
```

Terminal 2:

```sql
begin;
select public.reserve_credits('G2');  -- deve BLOQUEAR aqui
```

Terminal 1:

```sql
commit;
```

O terminal 2 deve então destravar e falhar com `Insufficient credits`, porque
`reserve_credits` trava a linha do perfil (`for update`) antes de somar o saldo.
Saldo final esperado: 0, com exatamente uma linha `reserve:` no ledger.
Se o terminal 2 **não** bloquear ou passar com saldo negativo, a serialização
está quebrada — não libere o provedor real.
