-- Re-score existing vessel-wide fairness rows after the calibrated score scale.
-- This only changes derived score fields; assignments, history and counts stay intact.
with burdened as (
  select
    vf.vessel_id,
    vf.crew_id,
    vf.weekday_opportunities + vf.weekend_opportunities as opp_total,
    ((vf.weekday_watches - vf.friday_watches) * 1.0
      + vf.friday_watches * 1.5
      + vf.weekend_watches * 1.3) as burden
  from vessel_fairness vf
), rated as (
  select * from burdened where opp_total > 0
), stats as (
  select
    r.vessel_id,
    m.mean_burden,
    greatest(sqrt(avg(power(r.burden - m.mean_burden, 2))), 0.5) as spread
  from rated r
  join (select vessel_id, avg(burden) as mean_burden from rated group by vessel_id) m using (vessel_id)
  group by r.vessel_id, m.mean_burden
), scored as (
  select
    b.vessel_id,
    b.crew_id,
    case
      when b.opp_total = 0 then 100::numeric
      else greatest(0::numeric, least(100::numeric,
        100 - abs((b.burden - s.mean_burden) / s.spread) * 12))
    end as fairness_score,
    case
      when b.opp_total = 0 then 0::numeric
      else b.burden - s.mean_burden
    end as deviation
  from burdened b
  left join stats s using (vessel_id)
)
update vessel_fairness vf
set
  fairness_score = scored.fairness_score,
  deviation = scored.deviation,
  balance = case
    when scored.deviation > 0.000001 then 'over'
    when scored.deviation < -0.000001 then 'under'
    else 'even'
  end,
  updated_at = now()
from scored
where vf.vessel_id = scored.vessel_id
  and vf.crew_id = scored.crew_id;
