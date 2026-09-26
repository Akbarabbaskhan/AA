-- Denormalises the session's date onto the attendance record.
--
-- Added nullable, backfilled from the session, then made NOT NULL, so an existing tenant's
-- six hundred thousand records survive the migration rather than blocking it.
ALTER TABLE "attendance_records" ADD COLUMN "date" DATE;

UPDATE "attendance_records" r
SET "date" = s."date"
FROM "attendance_sessions" s
WHERE s."id" = r."session_id" AND r."date" IS NULL;

ALTER TABLE "attendance_records" ALTER COLUMN "date" SET NOT NULL;

-- The streak and any "which days" question read this index instead of joining sessions. One
-- index, not two: each one costs the bulk loader about two seconds, and this is the one the
-- per-student lookups actually use.
CREATE INDEX "attendance_records_student_id_date_idx" ON "attendance_records"("student_id", "date");
