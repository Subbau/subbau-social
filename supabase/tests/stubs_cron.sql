-- Náhrada pg_cron a pg_net (Supabase je dodá jako rozšíření) — jen pro test setup souborů.
-- cron.schedule ukládá úlohu podle jména (jako pg_cron ≥ 1.4), net.http_post si zapíše požadavek.
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, end_time timestamptz);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;

create schema net;
create table net.pozadavky (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds int);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds int default 5000)
returns bigint language sql as $$
  insert into net.pozadavky (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds) returning id;
$$;
