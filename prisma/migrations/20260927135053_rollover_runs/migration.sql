-- CreateEnum
CREATE TYPE "RolloverStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'REVERTED');

-- CreateTable
CREATE TABLE "rollover_runs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "from_year_id" TEXT NOT NULL,
    "to_year_id" TEXT,
    "status" "RolloverStatus" NOT NULL DEFAULT 'PREVIEW',
    "input_json" JSONB NOT NULL,
    "plan_json" JSONB NOT NULL,
    "result_json" JSONB,
    "created_by_user_id" TEXT,
    "committed_at" TIMESTAMP(3),
    "reverted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rollover_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rollover_runs_school_id_status_idx" ON "rollover_runs"("school_id", "status");

-- CreateIndex
CREATE INDEX "rollover_runs_school_id_created_at_idx" ON "rollover_runs"("school_id", "created_at");

-- AddForeignKey
ALTER TABLE "rollover_runs" ADD CONSTRAINT "rollover_runs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
