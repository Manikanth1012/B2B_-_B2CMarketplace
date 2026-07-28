-- Reconcile onboarding identity with the partners table.
--
-- onboarding_gates used its own id space (P-013/014/015) with near-duplicate
-- names, and had no foreign key. partners?id=in.(P-013,P-014,P-015) returned
-- nothing, so the partner console had no join path to its own onboarding and
-- read a hardcoded array instead.
--
-- Original values, for the record:
--   P-013 'Nimbus IoT Solutions'    -> PTR-1004 'Nimbus Sensors'
--   P-014 'Sentinel Cyber Systems'  -> PTR-1003 'Sentinel Cyber'
--   P-015 'StreamNova Media'        -> PTR-1001 'StreamNova Media'
--
-- Not designed to roll back: a cleared gate pointing at a partner who does not
-- exist is worse than the rename.

UPDATE onboarding_gates SET partner_id = 'PTR-1004' WHERE partner_id = 'P-013';
UPDATE onboarding_gates SET partner_id = 'PTR-1003' WHERE partner_id = 'P-014';
UPDATE onboarding_gates SET partner_id = 'PTR-1001' WHERE partner_id = 'P-015';

-- Refuse to continue if anything still fails to resolve.
DO $$
DECLARE orphans int;
BEGIN
  SELECT count(*) INTO orphans
  FROM onboarding_gates g
  LEFT JOIN partners p ON p.id = g.partner_id
  WHERE p.id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'Cannot add foreign key: % onboarding_gates rows do not resolve to a partner', orphans;
  END IF;
END $$;

ALTER TABLE onboarding_gates
  ADD CONSTRAINT onboarding_gates_partner_fk
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE;

-- A copy of a name that can disagree with its source. Join instead.
ALTER TABLE onboarding_gates DROP COLUMN partner_name;
