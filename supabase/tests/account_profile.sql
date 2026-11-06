-- Run in a transaction and roll back. Only synthetic identities are touched.
do $$
declare
 u uuid := gen_random_uuid(); other_u uuid := gen_random_uuid();
 first_email text := 'profile-test-'||u||'@example.invalid';
 next_email text := 'profile-next-'||u||'@example.invalid';
 handle text := 'audit_'||replace(u::text,'-','');
begin
 handle := left(handle,32);
 insert into auth.users(id,email,raw_user_meta_data) values(u,first_email,'{}'),(other_u,'other-'||u||'@example.invalid','{}');
 if (select email from profiles where id=u) is distinct from first_email then raise exception 'TEST: bootstrap email mismatch'; end if;
 -- Stand-in for the database update performed by a confirmed Auth email change.
 update auth.users set email=next_email where id=u;
 if (select email from profiles where id=u) is distinct from next_email then raise exception 'TEST: confirmed email did not sync'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 set local role authenticated;
 begin
   update profiles set vessel_id=(select current_vessel_id()) where id=u;
   -- Same-vessel writes are harmless; changing even to NULL must be refused.
   update profiles set vessel_id=null where id=u;
   raise exception 'TEST: client changed vessel membership';
 exception when insufficient_privilege then null; end;
 begin
   update profiles set email=first_email where id=u;
   raise exception 'TEST: client changed login email mirror';
 exception when insufficient_privilege then null; end;
 update profiles set full_name='Verified Test Name',username=handle where id=u;
 if (select full_name from profiles where id=u)<>'Verified Test Name' or (select username from profiles where id=u)<>handle then raise exception 'TEST: profile did not persist'; end if;
 update profiles set full_name='Foreign edit' where id=other_u;
 if exists(select 1 from profiles where id=other_u) then raise exception 'TEST: foreign profile visible'; end if;
 begin
   update profiles set username='bad.name' where id=u;
   raise exception 'TEST: invalid username accepted';
 exception when check_violation then null; end;
 begin
   update profiles set payment_status='active' where id=u;
   raise exception 'TEST: client changed subscription';
 exception when raise_exception then
   if sqlerrm<>'gate columns are server-managed' then raise; end if;
 end;
 reset role;
 if (select full_name from profiles where id=other_u) is not null then raise exception 'TEST: foreign profile changed'; end if;
 perform set_config('request.jwt.claim.sub',other_u::text,true);
 set local role authenticated;
 begin
   update profiles set username=handle where id=other_u;
   raise exception 'TEST: duplicate username accepted';
 exception when unique_violation then null; end;
 reset role;
 perform set_config('request.jwt.claim.sub','',true);
end $$;
