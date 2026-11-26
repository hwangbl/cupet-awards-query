create table public.cupet_comments (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  nickname text not null check (char_length(nickname) between 1 and 30),
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'))
);
alter table public.cupet_comments enable row level security;
revoke all on table public.cupet_comments from public, anon, authenticated;
grant select, insert on table public.cupet_comments to service_role;
revoke all on sequence public.cupet_comments_id_seq from public, anon, authenticated;
grant usage on sequence public.cupet_comments_id_seq to service_role;
create index cupet_comments_approved_order on public.cupet_comments (id desc) where status = 'approved';
create index cupet_comments_submission_time on public.cupet_comments (created_at desc);

create function public.submit_cupet_comment(p_request_id uuid, p_nickname text, p_message text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(639854702, 1);
  if exists (select 1 from public.cupet_comments where request_id = p_request_id) then
    return 'accepted';
  end if;
  if (select count(*) from (
    select 1 from public.cupet_comments where created_at >= now() - interval '1 minute' limit 20
  ) recent) >= 20 then
    return 'busy';
  end if;
  insert into public.cupet_comments (request_id, nickname, message)
  values (p_request_id, p_nickname, p_message);
  return 'accepted';
end;
$$;
revoke all on function public.submit_cupet_comment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_cupet_comment(uuid, text, text) to service_role;
