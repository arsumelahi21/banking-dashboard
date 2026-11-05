-- The first version let the planner scan all ledger lines on every insert, so each
-- payment got slower as customers were added. Starting from the affected transactions
-- and looking up each one's lines through the index keeps the cost tied to the insert.
CREATE OR REPLACE FUNCTION ledger_assert_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT transaction_id FROM new_rows) affected
    CROSS JOIN LATERAL (
      SELECT SUM(l.amount_cents) AS total
      FROM ledger_entries l
      WHERE l.transaction_id = affected.transaction_id
    ) lines
    WHERE lines.total <> 0
  ) THEN
    RAISE EXCEPTION 'unbalanced ledger transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
