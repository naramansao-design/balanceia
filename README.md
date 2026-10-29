# CenaLab — MVP local

Aplicação Next.js App Router + TypeScript + Tailwind. Interface pt-BR, nome e
cores centralizados em `src/config/brand.ts`. Sem deploy, sem checkout e sem
chamadas a provedores pagos.

## Executar

Requer Node.js 22 e npm.

```sh
npm ci
npm run dev
```

Abra http://127.0.0.1:3000. Para produção local: `npm run build`, depois
`npm start`.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` usa o runner nativo do Node com remoção de tipos
(`--experimental-strip-types`) e a condição `react-server`, necessária porque os
módulos de servidor usam `import "server-only"`.

## Feito e verificado — 29/10/2026

Cada item abaixo foi executado nesta sessão; o comando e o resultado estão
registrados.

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Tipos | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Testes | `npm test` | 12 passaram, 0 falharam |
| Build | `npm run build` | exit 0, Next.js 16.4.3, 14 páginas |

Verificado no navegador, com servidor de desenvolvimento:

- Fluxo de três passos completo: escolher cena → autorizar e escolher foto →
  conferir e simular. Observados **Processando** e depois **Concluído**, com
  "Nenhum vídeo foi gerado; download indisponível".
- Maioridade e termos são **duas confirmações separadas**, espelhando as duas
  colunas que o banco exige. Com só a maioridade marcada, o botão de sessão
  continua desabilitado e o rodapé diz "Nenhuma confirmação registrada nesta
  sessão"; com as duas, aparece a data/hora de cada uma.
- A autorização de imagem é obrigatória para avançar: foto escolhida sem a
  caixa marcada mantém "Continuar" desabilitado.
- Escolher um personagem já salvo **não** marca a caixa sozinho: a caixa
  desaparece e aparece a autorização registrada daquele personagem.
- Se a inspeção da foto não concluir em 10 s, aparece "Escolha uma foto válida e
  confirme a autorização" em vez de ficar em silêncio.
- As 6 rotas principais responderam HTTP 200 e não há rolagem horizontal em
  375 × 812.
- A API demo aceitou entrada válida (200) e rejeitou com 400: autorização
  ausente, cena inexistente e id de consulta malformado.

Nenhum nome de modelo de IA aparece na interface: as únicas menções ao motor
estão em `src/server/providers/index.ts`, que é código de servidor.

## Demonstração

Tudo o que a aplicação mostra hoje é simulação rotulada.

- Seis cenas ficcionais originais com capas SVG próprias, marcadas "Exemplo";
  preço e qualidade aparecem como "Preço de exemplo" e "Qualidade de exemplo".
- Sem autenticação real e sem persistência: a sessão, o elenco e as criações
  vivem em memória. Recarregar ou fechar a página apaga tudo.
- A foto não sai do navegador. Fica em object URL e é liberada ao encerrar.
  Seleção local JPG/PNG/WebP até 8 MB, com MIME, assinatura de bytes e
  decodificação verificados.
- `DemoProvider` apenas mede tempo decorrido; não existe arquivo de vídeo e
  portanto não existe download.
- Nenhum crédito real é reservado ou estornado. O teste "Testar falha e estorno"
  mostra apenas o texto do comportamento esperado.
- Conta informa explicitamente que saldo real e compra de créditos não existem.

## Motor de vídeo

`src/server/providers/index.ts` traz a interface `VideoProvider`, o
`DemoProvider` e o `WanAnimateReplaceProvider` implementado contra a API de fila
documentada da fal.ai (`POST https://queue.fal.run/fal-ai/wan/v2.2-14b/animate/replace`,
cabeçalho `Authorization: Key …`, status e resultado em
`https://queue.fal.run/fal-ai/wan/requests/{id}`).

Proteções embutidas:

- `getVideoProvider()` é o único lugar que escolhe o provedor e devolve o
  `DemoProvider` para qualquer valor de `ENABLE_REAL_PROVIDER` diferente da
  string exata `"true"`. Com a flag ligada e sem `FAL_KEY`, falha em vez de cair
  em silêncio para a demonstração.
- A submissão exige vídeo de referência **armazenado a 16 fps**. O endpoint não
  tem parâmetro de fps, então essa é a única forma de pagar metade: a cobrança é
  por frame, em blocos de 16. Reamostrar é tarefa do pipeline de assets
  (`ffmpeg -r 16`), feita uma vez por cena; o provedor recusa qualquer outra
  taxa para o custo não dobrar sem ninguém perceber.
- Duração limitada a 10 s e URLs obrigatoriamente `https`.
- Resolução aceita apenas `480p` (US$ 0,04 por segundo faturado) e `720p`
  (US$ 0,08). O endpoint também aceita `580p`, recusado aqui porque não temos
  preço publicado e inventar um colocaria número falso na frente de quem paga.
- Custo **estimado** e **real** são campos separados. O custo real fica `null`
  até ser reconciliado com os registros de uso do provedor; a estimativa nunca é
  copiada para ele.

A rota `/api/demo/generations` está fixada no `DemoProvider` de propósito: ela
não debita nada e não tem dono autenticado, então continua simulação mesmo se a
flag for ligada.

`src/server/generation-service.ts` orquestra criar → reservar → submeter →
acompanhar → estornar. `src/server/memory-repository.ts` é uma implementação em
memória que espelha a semântica das RPCs (ledger só-append, um débito por
geração, estorno só após falha e no máximo uma vez) para que essa orquestração
rode sob teste. **Não é fronteira de segurança** e não deve servir usuário real.

## Supabase (preparado, não aplicado)

Copie `.env.example` para `.env.local`. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
e `FAL_KEY` são exclusivos do servidor; nunca use prefixo `NEXT_PUBLIC_`.
`.env*` está no `.gitignore`.

`supabase/migrations/`:

- `…0001_initial.sql` — tabelas, RLS ativa nas cinco, `revoke all` antes dos
  grants, leitura só do próprio dono, `scenes` legível apenas quando ativa,
  escrita exclusiva do servidor, chaves estrangeiras compostas que impedem
  cruzar dados entre usuários, buckets privados com MIME e limite de tamanho,
  saldo calculado no banco, reserva transacional serializada por dono e estorno
  idempotente. As RPCs de mutação só são executáveis pelo `service_role`.
- `…0002_idempotency.sql` — chave de idempotência de submissão.
- `…0003_hardening.sql` — **novo nesta rodada.** Ledger só-append via trigger
  `ENABLE ALWAYS` (bloqueia `UPDATE`, `DELETE` e `TRUNCATE` até para o dono da
  tabela); criação automática de `profiles` a partir de `auth.users`; e
  `record_consent()`, que grava os dois consentimentos com a hora do banco.
  Antes dela, `reserve_credits` nunca poderia passar pela própria checagem de
  consentimento, porque não havia caminho algum para preencher aquelas colunas.

`supabase/seed.sql` tem as seis cenas de exemplo. **Nenhum comando remoto foi
executado e nenhuma migration foi aplicada em lugar nenhum.**

### Testes de banco

`supabase/tests/database/credits.test.sql` são 15 asserções pgTAP provando
isolamento entre usuários, impossibilidade de o cliente creditar a si mesmo,
falha com saldo insuficiente, débito e estorno únicos e ledger imutável.
`supabase/tests/README.md` tem como rodar e o procedimento manual de
concorrência, que exige duas conexões.

**Esses testes não foram executados.** Não há Docker, Supabase CLI nem `psql`
nesta máquina. Nada aqui autoriza qualquer afirmação de segurança até eles
rodarem num banco isolado.

## Pendente para cobrar o primeiro cliente

1. Rodar os testes pgTAP e o teste de concorrência num projeto isolado. Sem
   isso, as garantias do banco são intenção, não fato.
2. Adaptador Supabase real: Supabase Auth, `GenerationRepository` chamando as
   RPCs, upload com inspeção no servidor e URLs assinadas de 60 s após conferir
   o proprietário.
3. Validar qualidade e contrato do provedor real com autorização explícita, e
   reconciliar o custo real com o uso faturado antes de qualquer cobrança.
4. Definir a razão crédito ↔ dólar. Hoje não existe no código: uma cena de 8 s a
   16 fps custa ~US$ 0,64 em 720p e é vendida por 12 créditos sem conversão
   definida.
5. Worker durável de gerações, reconciliação e retentativas; recuperação entre o
   submit externo e a gravação do request id.
6. Pipeline de assets convertendo as referências para 16 fps e publicando-as no
   bucket privado. Os `capa_path` do seed são placeholders, não uploads.
7. Checkout e compra de créditos (hoje desabilitados), termos definitivos e
   revisão de segurança antes de operar com fotos reais de pessoas.

Referências: [Next.js](https://nextjs.org/docs/app/getting-started/installation),
[fal.ai queue](https://fal.ai/docs/model-endpoints/queue),
[Supabase Functions](https://supabase.com/docs/guides/database/functions),
[Storage RLS](https://supabase.com/docs/guides/storage/security/access-control).

## Não verificado

- O botão "Testar falha e estorno" não foi reexecutado depois da mudança no
  polling: o painel de navegador parou de desenhar e `img.decode()` deixou de
  resolver, o que impede carregar uma foto e chegar ao passo 3. A lógica em si
  não mudou, mas trate como não verificado.
- Nada relativo ao banco de dados.
