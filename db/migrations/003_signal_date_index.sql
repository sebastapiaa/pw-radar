-- The list and home pages compute max(signal_date) per company; the existing
-- (zi_company_id, observed_at) index does not serve that.
create index signals_company_signal_date_idx on signals (zi_company_id, signal_date desc);
create index findings_created_company_idx on findings (created_at desc, zi_company_id);
