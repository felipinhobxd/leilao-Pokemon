create index if not exists auction_publish_queues_group_idx on public.auction_publish_queues(group_id);
create index if not exists auction_publish_queues_creator_idx on public.auction_publish_queues(created_by, created_at desc);
