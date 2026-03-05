create or replace function admin_clear_reports()
returns void as $$
begin
  -- Solo permitir si el usuario es admin
  if not exists (
    select 1 from profiles 
    where id = auth.uid() 
    and role = 'admin'
  ) then
    raise exception 'Unauthorized';
  end if;

  delete from user_reports where true;
end;
$$ language plpgsql security definer;
