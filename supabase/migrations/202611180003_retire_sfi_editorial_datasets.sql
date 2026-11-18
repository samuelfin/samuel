-- Samuel Terminal — editorial is not a dataset.
--
-- `news.items` and `research.reports` were seeded as datasets owned by the SFI
-- provider. That was the wrong shape. A dataset describes licensed third-party
-- material arriving through ingestion, with a provider, a licence basis and an
-- activation gate. SFI's own writing is none of those things: it is authored in
-- house, carries no licence, and earns its authority by citing documents and
-- approved observations while passing human review.
--
-- Editorial therefore sits beside the provider/dataset machinery, not inside it.
-- See docs/ARCHITECTURE_AND_DATA_MODEL.md, "Delivery priority".
--
-- The SFI provider row itself is kept: `rights_status = 'owned'` remains a
-- meaningful category for SFI-derived data (calculated metrics, for instance), and
-- the application can still name it through a provider override.

do $$
declare
  blocked integer;
begin
  -- These datasets were never activated and should have no provenance behind them.
  -- If anything was ingested against them, stop rather than orphan or delete it.
  select count(*) into blocked
  from public.source_records
  where dataset_id in ('news.items', 'research.reports');

  if blocked > 0 then
    raise exception
      'Cannot retire the SFI editorial datasets: % source record(s) reference them. Migrate that provenance first.',
      blocked;
  end if;

  delete from public.datasets where id in ('news.items', 'research.reports');
end;
$$;
