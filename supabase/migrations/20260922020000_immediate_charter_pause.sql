-- An immediate Charter Mode pause starts today and remains open until the captain
-- explicitly unpauses it. It is kept separate from a normally planned charter so
-- unpausing cannot accidentally cancel a future charter booking.
alter table charter_periods
  add column is_immediate boolean not null default false;

comment on column charter_periods.is_immediate is
  'True when this is the captain-triggered immediate pause rather than a planned charter window.';
