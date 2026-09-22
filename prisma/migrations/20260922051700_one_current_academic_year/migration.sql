-- "Only one current per school" — a partial unique index, which Prisma's schema language
-- cannot express. Without this, two rows can claim is_current and every academic-year-scoped
-- query silently picks the wrong one.
CREATE UNIQUE INDEX "academic_years_one_current_per_school"
  ON "academic_years" ("school_id")
  WHERE "is_current" = true;

-- A student is never enrolled in the same section twice within one academic year, and a
-- voucher number is unique per tenant (already enforced) — but a paid invoice must never
-- go negative, and a payment must never be zero or negative.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_non_negative" CHECK ("total" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount_non_negative" CHECK ("discount" >= 0);

-- A mark is never negative, and never above its assessment total. The upper bound needs a
-- join so it lives in the service layer; the floor belongs here.
ALTER TABLE "marks" ADD CONSTRAINT "marks_non_negative" CHECK ("marks_obtained" IS NULL OR "marks_obtained" >= 0);

-- Component weights are percentages.
ALTER TABLE "subject_components" ADD CONSTRAINT "subject_components_weight_range"
  CHECK ("weight_percent" >= 0 AND "weight_percent" <= 100);
