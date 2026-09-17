-- ZoomInfo's own signal id (intent: "<hash>#<companyId>#<yyyymmdd>", scoop: numeric).
-- Intent is published in weekly batches (every intent signal in the first run
-- carried the same date), so a signal re-observed by the next morning's run is
-- the same signal, not new evidence. Store each once; runs keep the counts.
alter table signals add column zi_signal_id text;
create unique index signals_zi_signal_id_key on signals (zi_signal_id) where zi_signal_id is not null;
