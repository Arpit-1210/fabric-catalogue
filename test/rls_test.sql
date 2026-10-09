\set ON_ERROR_STOP off
\pset pager off
-- helper: run as a given login
create or replace function pg_temp.as_user(e text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', case when e is null then '' else json_build_object('email', e)::text end, false);
end $$;

-- admin creates staff via function (as authenticated admin)
set role authenticated;
select pg_temp.as_user('admin@gfpl.com');
select 'admin whoami', fp_whoami();
select 'add staff', fp_add_staff('ravi@shop.com', 'Ravi', 'temp12345', 'staff');
select 'short pw rejected' as t, (select 1) ; 
select fp_add_staff('x@shop.com','X','short','staff');
-- existing login from another app must not be hijacked
reset role;
insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), 'pankaj@gfpl.com', 'x');
set role authenticated; select pg_temp.as_user('admin@gfpl.com');
select 'hijack blocked?', fp_add_staff('pankaj@gfpl.com','P','temp12345','staff');

-- staff creates designs
select pg_temp.as_user('ravi@shop.com');
select 'staff whoami', fp_whoami();
select 'code 1', code from fp_create_design(jsonb_build_object('category_id',(select id from fp_categories where prefix='RP'),'name','Rose Garden','colours','pink, red'));
select 'code 2', code from fp_create_design(jsonb_build_object('category_id',(select id from fp_categories where prefix='RP'),'name','Paisley'));
select 'code VF', code from fp_create_design(jsonb_build_object('category_id',(select id from fp_categories where prefix='VF'),'name','Gold Leaf'));
select 'blank name rejected', code from fp_create_design(jsonb_build_object('category_id',(select id from fp_categories where prefix='DP'),'name','  '));
-- after the rejected blank name the DP counter must be unchanged
select 'DP next (expect 1)', next_number from fp_categories where prefix='DP';
select 'code DP', code from fp_create_design(jsonb_build_object('category_id',(select id from fp_categories where prefix='DP'),'name','Sky'));

-- shades + stock
insert into fp_shades (design_id, shade_code, colour, unit, stock) select id, 'S-01', 'pink', 'meters', 999 from fp_designs where code='RP-001';
select 'stock forced to 0', stock from fp_shades where shade_code='S-01';
insert into fp_shades (design_id, shade_code) select id, 's-01' from fp_designs where code='RP-001';   -- duplicate shade (case-insens)
select 'move +200', stock from fp_stock_apply((select id from fp_shades where shade_code='S-01'), 'add', 200, 'opening');
select 'move -50', stock from fp_stock_apply((select id from fp_shades where shade_code='S-01'), 'add', -50, 'sold');
select 'overdraw blocked', stock from fp_stock_apply((select id from fp_shades where shade_code='S-01'), 'add', -500, 'x');
update fp_shades set stock = 5 where shade_code='S-01';  -- direct stock edit blocked
select 'stock now (expect 150)', stock from fp_shades where shade_code='S-01';
select 'moves', kind, delta, balance, by_email from fp_stock_moves order by created_at;
select 'bulk', fp_stock_bulk(jsonb_build_array(jsonb_build_object('shade_id',(select id from fp_shades where shade_code='S-01'),'qty',10,'unit','rolls')),'set','xl');
select 'unit now', unit, stock from fp_shades where shade_code='S-01';

-- immutability / no delete
update fp_designs set code='ZZ-999' where code='RP-001';
update fp_designs set category_id=(select id from fp_categories where prefix='VF') where code='RP-001';
delete from fp_designs where code='RP-001';
delete from fp_shades;
update fp_designs set archived=true where code='RP-002';
select 'archived', code, archived from fp_designs where code='RP-002';

-- staff must NOT do admin things
select 'staff list (expect 0 rows)', count(*) from fp_staff;
select fp_add_staff('evil@shop.com','E','temp12345','admin');
select 'staff change prefix (expect 0 updated)'; update fp_categories set prefix='XX' where prefix='RP';
select 'staff read audit (expect 0)', count(*) from fp_audit;
insert into fp_stock_moves (shade_id, delta, balance, kind) values ((select id from fp_shades limit 1), 1, 1, 'x');
insert into fp_designs (code, category_id, name) values ('HACK-1', (select id from fp_categories limit 1), 'h');

-- admin config
select pg_temp.as_user('admin@gfpl.com');
update fp_categories set prefix='RPX' where name='Roto Print'; -- too long? RPX is 3 letters (ok)
select 'prefix changed', prefix from fp_categories where name='Roto Print';
select 'new RP code uses new prefix', code from fp_create_design(jsonb_build_object('category_id',(select id from fp_categories where name='Roto Print'),'name','New one'));
select 'old code intact', code from fp_designs where name='Rose Garden';
select 'admin audit rows >0', count(*) > 0 from fp_audit;
select fp_set_staff('admin@gfpl.com', false);   -- last admin cannot be deactivated
select fp_set_staff('ravi@shop.com', false);
select pg_temp.as_user('ravi@shop.com');
select 'deactivated staff sees (expect 0)', count(*) from fp_designs;
select 'deactivated whoami', fp_whoami();

-- other-app logins and anonymous see nothing
select pg_temp.as_user('pankaj@gfpl.com');
select 'other app login designs (expect 0)', count(*) from fp_designs;
select fp_create_design(jsonb_build_object('category_id',(select id from fp_categories limit 1),'name','x'));
select 'other-app storage insert', 1 from (select 1) q where false;
insert into storage.objects (bucket_id, name) values ('fabrics', 'designs/x.jpg');
reset role; set role anon;
select 'anon designs', count(*) from fp_designs;
select fp_whoami();
reset role;
select 'other tables untouched; objects count (expect 0)', count(*) from storage.objects;
