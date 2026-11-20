-- Shift - accounts made from another MEL Barn tool get no Shift profile at
-- sign-up; Shift makes one the first time the account opens Shift.
--
-- MEL Barn accounts are shared across tools. Sign-ups from Bellwether carry
-- raw_user_meta_data.signup_tool = 'bellwether'; the trigger leaves those out.
-- Sign-ups from Shift, the dashboard or older accounts behave as before.
-- The app calls shift.ensure_profile() after sign-in (src/auth.js), so deploy
-- the app first; until this file runs, that call fails quietly and changes nothing.
--
-- Safe to run more than once. signup_tool is set by whoever signs up, so the
-- most anyone can do with it is go without their own Shift profile.

create or replace function shift.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(new.raw_user_meta_data ->> 'signup_tool', 'shift') <> 'shift' then
    return new;                                   -- joined from another MEL tool
  end if;
  insert into shift.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function shift.ensure_profile()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  insert into shift.profiles (id, email, display_name)
  select u.id,
         coalesce(u.email, ''),
         coalesce(u.raw_user_meta_data ->> 'display_name', split_part(coalesce(u.email, ''), '@', 1))
  from auth.users u
  where u.id = auth.uid()
  on conflict (id) do nothing;
end;
$function$;

revoke all on function shift.ensure_profile() from public, anon;
grant execute on function shift.ensure_profile() to authenticated;
