-- Digby's CPS 3 — run once in the CPS project (SQL editor → New query → Run).
-- Adds the columns History uses to show where each label came from.
-- Safe to run more than once; changes nothing that's already there.
alter table public.print_jobs add column if not exists source text;
alter table public.print_jobs add column if not exists label_type text;
alter table public.print_jobs add column if not exists allergens_edited boolean not null default false;
alter table public.print_jobs add column if not exists status_date date;
alter table public.print_jobs add column if not exists weight_display text;
alter table public.print_jobs add column if not exists label_status text;
alter table public.print_jobs add column if not exists notes text;
notify pgrst, 'reload schema';
