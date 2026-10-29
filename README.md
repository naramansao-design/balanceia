# CenaLab — MVP local

Aplicação Next.js App Router + TypeScript + Tailwind. Interface pt-BR, tema configurável em `src/config/brand.ts`. Sem deploy, checkout ou chamadas a provedores pagos.

## Executar

Requer Node.js 22 e npm.

```sh
npm ci
npm run dev
```

Abra http://127.0.0.1:3000. Para produção local: `npm run build`, depois `npm start`.

```sh
npm run typecheck
npm run lint
npm run build
```

## Funciona localmente

- Catálogo público com seis cenas originais fictícias e capas SVG próprias marcadas Exemplo; filtros, páginas compartilháveis e fluxo de três passos.
- Sessão de demonstração explícita no passo 2, confirmação de maioridade/termos e autorização de imagem obrigatória.
- Seleção local JPG/PNG/WebP até 8 MB com MIME, assinatura e decodificação verificados. Foto não sai do navegador.
- Meu Elenco: adicionar, selecionar e excluir personagens temporários; data/hora da autorização mantida em memória.
- Simulação assíncrona por API de servidor e polling: Aguardando → Processando → Concluído. Opção de falha demonstrativa. Sem arquivo de vídeo, portanto sem download.
- Estado temporário compartilhado entre páginas, sem localStorage ou banco. Recarregar/fechar apaga tudo.
- Conta com indisponibilidade explícita de saldo real e compra de créditos.

## Demonstração e limites

A aplicação permanece deliberadamente em demonstração mesmo se variáveis forem preenchidas. Não existe autenticação real ou persistência integrada. Os preços e a qualidade são exemplos configurados, não cotação de fornecedor. Não há crédito real reservado/estornado na demonstração; o teste de falha mostra somente o comportamento esperado. Fotos ficam em object URLs na memória e são liberadas ao encerrar a sessão da aplicação. Não há upload remoto nem promessa de armazenamento seguro implementado pela interface.

`src/server/providers` contém a interface VideoProvider, DemoProvider e esqueleto WanAnimateReplaceProvider. O provedor real lança erro de indisponibilidade; nenhum endpoint pago é chamado.

`src/server/generation-service.ts` contém a orquestração de reserva antes do submit, acompanhamento e estorno; exige um adaptador de repositório autenticado. Não está ligado à API demo, pois essa API não debita saldo. Recuperação após queda entre submit externo e gravação do request ID exige worker/reconciliação antes de habilitar produção.

## Supabase (preparado, não aplicado)

Copie `.env.example` para `.env.local` somente ao integrar o adaptador. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são exclusivos do servidor; nunca use prefixo NEXT_PUBLIC para a chave de serviço.

Migrations em `supabase/migrations/` definem tabelas, RLS de leitura por proprietário, escrita exclusiva pelo servidor, buckets privados, saldo calculado no banco, reserva transacional serializada por proprietário e estorno idempotente baseado no débito original. RPCs de mutação são executáveis somente pelo service role. `supabase/seed.sql` oferece seis cenas de exemplo e instrução comentada para crédito administrativo de teste. Nenhum comando remoto foi executado.

Antes da integração real: aplicar migrations em ambiente separado; testar RLS, concorrência, idempotência e isolamento entre usuários; implementar Supabase Auth, aceite e autorização com horário do servidor, upload com inspeção server-side e URLs assinadas de 60 segundos após verificar proprietário. As capas demo são assets locais públicos; os paths SQL são placeholders e não são uploads reais. Os buckets não permitem SVG de usuário.

## Pendente para produção

1. Adaptador Supabase e login real; CRUD remoto e termos definitivos.
2. Worker durável de gerações, reconciliação e retentativas; armazenamento de resultado real e download assinado.
3. Integração e validação contratual do provedor real, somente com autorização separada; custo real separado do estimado.
4. Testes de migrations/RLS em banco isolado e revisão de segurança antes de operar com fotos reais.
5. Tradução en (tipo de locale reservado; pt-BR implementado).

Referências consultadas: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [Supabase Functions](https://supabase.com/docs/guides/database/functions), [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control).
