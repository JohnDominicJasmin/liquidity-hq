-- Add chat usage columns to grok_usage for GrokChat widget rate limiting
alter table grok_usage
  add column if not exists chat_count        int not null default 0,
  add column if not exists chat_search_count int not null default 0;
