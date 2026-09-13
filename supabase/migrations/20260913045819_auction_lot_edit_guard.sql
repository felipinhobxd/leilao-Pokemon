create or replace function public.guard_published_lot_number() returns trigger language plpgsql set search_path='' as $$
begin
  if old.lot_number is distinct from new.lot_number and old.status<>'draft' then
    raise exception 'lot_number_locked_after_publication';
  end if;
  return new;
end $$;
drop trigger if exists guard_published_lot_number on public.auctions;
create trigger guard_published_lot_number before update of lot_number on public.auctions for each row execute function public.guard_published_lot_number();
revoke execute on function public.guard_published_lot_number() from public,anon,authenticated;
