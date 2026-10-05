-- BiteSite schema. Run once in Supabase > SQL Editor.
create table public.profiles(
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  roll text, dept text,
  phone text check (phone is null or phone ~ '^[0-9]{10}$'),
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz default now());

create table public.menu_items(
  id uuid primary key default gen_random_uuid(),
  cat text not null, name text not null,
  price numeric(8,2) not null check (price >= 0),
  emoji text default '🍴', available boolean default true);

create table public.orders(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  cust_name text, cust_roll text, cust_dept text, cust_phone text,
  items jsonb not null, total numeric(8,2) not null,
  method text not null check (method in ('Cash','Online')),
  shot_path text,
  status text not null default 'Pending' check (status in ('Pending','Accepted','Rejected')),
  comment text default '' check (char_length(comment) <= 300),
  created_at timestamptz default now());

create table public.settings(id int primary key default 1 check (id = 1), upi text, phone text);
insert into public.settings(id) values (1);

-- helpers
create function public.is_admin() returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,name,roll,dept,phone) values (new.id,
    left(coalesce(new.raw_user_meta_data->>'name','Student'),80),
    left(new.raw_user_meta_data->>'roll',40), left(new.raw_user_meta_data->>'dept',40),
    nullif(new.raw_user_meta_data->>'phone',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- order placement: prices are read from the DB, never trusted from the browser
create function public.place_order(p_items jsonb, p_method text, p_shot text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_items jsonb := '[]'; v_total numeric := 0; r record; p public.profiles; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if p_method not in ('Cash','Online') then raise exception 'Bad payment method'; end if;
  if p_method = 'Online' and (p_shot is null or p_shot not like auth.uid()::text || '/%') then raise exception 'Payment screenshot required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'Bad cart'; end if;
  for r in select m.name, m.price, least(greatest((i->>'qty')::int,1),20) as qty
           from jsonb_array_elements(p_items) i
           join public.menu_items m on m.id = (i->>'id')::uuid and m.available
  loop
    v_items := v_items || jsonb_build_object('name', r.name, 'price', r.price, 'qty', r.qty);
    v_total := v_total + r.price * r.qty;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'No available items'; end if;
  select * into p from public.profiles where id = auth.uid();
  insert into public.orders(user_id,cust_name,cust_roll,cust_dept,cust_phone,items,total,method,shot_path)
  values (auth.uid(),p.name,p.roll,p.dept,p.phone,v_items,v_total,p_method, case when p_method='Online' then p_shot end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.place_order(jsonb,text,text) from public, anon;
grant execute on function public.place_order(jsonb,text,text) to authenticated;

-- Row Level Security
alter table public.profiles   enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders     enable row level security;
alter table public.settings   enable row level security;

create policy "profile read own/admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profile admin update"   on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "menu read"   on public.menu_items for select to authenticated using (true);
create policy "menu admin"  on public.menu_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "settings read"  on public.settings for select to authenticated using (true);
create policy "settings admin" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "orders read own/admin" on public.orders for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "orders admin update"   on public.orders for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- (students cannot INSERT/UPDATE orders directly; only place_order() can create them)

-- private bucket for payment screenshots
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('screenshots','screenshots',false,2097152,array['image/jpeg','image/png','image/webp']) on conflict do nothing;
create policy "shots insert own" on storage.objects for insert to authenticated
  with check (bucket_id='screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "shots read own/admin" on storage.objects for select to authenticated
  using (bucket_id='screenshots' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- live order updates
alter publication supabase_realtime add table public.orders;

-- starter menu
insert into public.menu_items(cat,name,price,emoji) values
('Good Morning','Bread Pattice',35,'🥪'),('Good Morning','Cream Roll',10,'🥐'),('Good Morning','Kachori',25,'🧆'),
('Good Morning','Paneer Puff',40,'🥟'),('Good Morning','Poha',35,'🍚'),('Good Morning','Samosa',25,'🥟'),
('Good Morning','Single Wada',20,'🍩'),('Hot Spot','Tea',10,'☕'),('Hot Spot','Coffee',15,'☕'),
('Chat Counter','Pani Puri',30,'🧆'),('Thali','Veg Thali',80,'🍛');
