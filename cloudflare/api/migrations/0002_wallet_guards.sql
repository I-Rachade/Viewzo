-- Guards that replace the PostgreSQL locks (pg_advisory_xact_lock) of
-- backend/src/wallet. D1 runs one statement at a time and a batch as one
-- unit, so a check written into the database cannot be raced: two
-- withdrawals sent at the same moment are checked one after the other.

-- A withdrawal or an escrow may never take more than the available balance:
-- completed money already available and not frozen, minus withdrawals still
-- pending. Same formula as WalletService.balance(). Dates are stored by
-- Prisma as ISO text in UTC, so they compare as strings.
CREATE TRIGGER "Transaction_no_overdraft"
BEFORE INSERT ON "Transaction"
WHEN NEW."amount" < 0 AND NEW."type" IN ('WITHDRAWAL', 'ESCROW')
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_BALANCE')
  WHERE (
    SELECT COALESCE(SUM("amount"), 0) FROM "Transaction"
    WHERE "userId" = NEW."userId"
      AND (
        ("status" = 'COMPLETED' AND "frozen" = 0
          AND "availableAt" <= strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
        OR ("status" = 'PENDING' AND "amount" < 0)
      )
  ) + NEW."amount" < 0;
END;

-- A payment only moves forward: a finished one is never reopened, whatever
-- the code asks.
CREATE TRIGGER "Payment_final_status"
BEFORE UPDATE OF "status" ON "Payment"
WHEN OLD."status" IN ('SUCCEEDED', 'FAILED', 'REJECTED') AND NEW."status" <> OLD."status"
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_FINAL');
END;
