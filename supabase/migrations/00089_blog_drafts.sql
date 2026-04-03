-- Blog draft auto-generation pipeline
-- Stores AI-generated blog post drafts for human review before publishing

create table if not exists public.blog_drafts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  description text not null default '',
  tags text[] not null default '{}',
  content text not null,
  sources jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft', 'approved', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz
);

-- Index for listing pending drafts
create index if not exists idx_blog_drafts_status on public.blog_drafts (status, created_at desc);

-- RLS: service role only (Inngest writes, admin API reads)
alter table public.blog_drafts enable row level security;

-- No public policies — only service role can access
comment on table public.blog_drafts is 'AI-generated blog post drafts awaiting human approval';
