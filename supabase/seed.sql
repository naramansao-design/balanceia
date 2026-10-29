-- Admin only. Original fictional examples; no reference videos or real generation capability.
insert into public.scenes(slug,titulo,descricao,categoria,capa_path,reference_video_path,duracao_s,engine,engine_params,preco_creditos,ativo) values
('orbita-particular','Órbita particular','Passeio fictício entre estrelas.','Em alta','examples/scene-0.svg',null,8,'demo','{}',12,true),
('reuniao-na-lua','Essa reunião podia ser na Lua','Um escritório intergaláctico fictício.','Humor','examples/scene-1.svg',null,6,'demo','{}',10,true),
('ultimo-trem','O último trem de neon','Uma estação imaginária.','Em alta','examples/scene-2.svg',null,8,'demo','{}',12,true),
('refugio-solar','Refúgio solar','Uma casa imaginária sobre o mar.','Luxo & viagens','examples/scene-3.svg',null,6,'demo','{}',10,true),
('chef-do-caos','Chef do caos','Uma cozinha fictícia divertida.','Humor','examples/scene-4.svg',null,6,'demo','{}',10,true),
('suite-nas-nuvens','Suíte nas nuvens','Hotel imaginário acima da cidade.','Luxo & viagens','examples/scene-5.svg',null,8,'demo','{}',12,true)
on conflict(slug) do nothing;
-- Optional admin test credits (run manually after creating a real profile):
-- insert into public.credit_ledger(user_id,delta,motivo,idempotency_key)
-- values ('REPLACE_WITH_PROFILE_UUID',100,'admin_test_seed','admin_test_seed:REPLACE_WITH_PROFILE_UUID');
-- Never run this script via an exposed route.
