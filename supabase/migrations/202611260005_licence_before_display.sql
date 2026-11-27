-- Samuel Terminal — the licence gate, checked when a reader asks, not only when
-- a dataset was switched on.
--
-- Binding rule 8 is "licences before display", and the write side already holds
-- it: the trigger on `datasets` refuses to activate one unless a licence from
-- the same provider is active, permits display and has not passed its valid_to.
-- The read side, is_displayable_source, asked only whether the dataset was
-- active — which is adequate at the moment of activation and goes stale
-- afterwards.
--
-- Three ways it went stale, all of which left data displaying:
--
--   * a licence revoked after the fact — status moved to 'expired' or
--     'terminated', or allows_display was turned off. The trigger does not fire
--     on a licence row, so nothing re-checked the dataset.
--   * a licence that simply lapsed. valid_to passes in the night; nobody flips
--     is_active on the morning it does.
--   * a licence that has not started. valid_from is not checked on activation at
--     all, so a dataset could be switched on ahead of its own terms.
--
-- So the question is asked again on every read, which is where it matters: a
-- reader sees a figure only while the terms permitting it hold today.
--
-- Two things are carried over from the trigger deliberately, because a read-time
-- check that disagreed with the write-time one would be worse than either alone:
--
--   * an internal provider needs no licence. SFI's own editorial and reference
--     datasets are not licensed from anybody, and demanding a licence row for
--     them would hide this platform's own writing.
--   * the licence must belong to the dataset's provider. A licence from one
--     provider does not license another's data, however active it is.
--
-- Deliberately unchanged: redistribution. allows_display and
-- allows_redistribution are separate grants, often priced differently and
-- sometimes one given while the other is refused. This function answers only
-- "may a reader see this"; the Phase 9 data API asks the other question and must
-- ask it separately.
--
-- Blast radius, checked before writing this: on sfi-dev every dataset is
-- is_active = false with licence_id null, so nothing that displays today stops
-- displaying.

create or replace function public.is_displayable_source(target_source uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.source_records s
      join public.datasets d on d.id = s.dataset_id
      join public.data_providers p on p.id = d.provider_id
     where s.id = target_source
       and d.is_active
       and (
         -- SFI's own data is not licensed from anybody.
         p.access_model = 'internal'
         or exists (
           select 1
             from public.data_licences l
            where l.id = d.licence_id
              and l.provider_id = d.provider_id
              and l.status = 'active'
              and l.allows_display
              and (l.valid_from is null or l.valid_from <= current_date)
              and (l.valid_to is null or l.valid_to >= current_date)
         )
       )
  );
$$;

-- CREATE OR REPLACE keeps the grants; re-stating them is cheaper than someone
-- later wondering whether it does.
revoke all on function public.is_displayable_source(uuid) from public, anon;
grant execute on function public.is_displayable_source(uuid) to authenticated;
