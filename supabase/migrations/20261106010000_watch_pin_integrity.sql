-- Fixed watches are vessel-scoped configuration and must invalidate a plan
-- calculated before a pin (or its consent) changed. No rota data is rewritten.
alter table crew_members add constraint crew_member_vessel_unique unique (id, vessel_id);

alter table watch_pins
  drop constraint watch_pins_crew_member_id_fkey,
  drop constraint watch_pins_lane_id_fkey,
  add constraint watch_pins_crew_member_id_fkey
    foreign key (crew_member_id, vessel_id) references crew_members(id, vessel_id) on delete cascade,
  add constraint watch_pins_lane_id_fkey
    foreign key (lane_id, vessel_id) references watch_lanes(id, vessel_id) on delete cascade;

create trigger rota_revision_pins
  after insert or update or delete on watch_pins
  for each row execute function bump_rota_revision();
