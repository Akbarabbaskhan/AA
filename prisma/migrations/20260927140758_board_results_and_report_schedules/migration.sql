-- CreateEnum
CREATE TYPE "ReportCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('XLSX', 'PDF');

-- CreateTable
CREATE TABLE "board_results" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "entered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "report_key" TEXT NOT NULL,
    "cadence" "ReportCadence" NOT NULL,
    "hour_local" INTEGER NOT NULL DEFAULT 7,
    "format" "ReportFormat" NOT NULL DEFAULT 'XLSX',
    "recipients_json" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_results_school_id_session_idx" ON "board_results"("school_id", "session");

-- CreateIndex
CREATE UNIQUE INDEX "board_results_student_id_subject_id_session_key" ON "board_results"("student_id", "subject_id", "session");

-- CreateIndex
CREATE INDEX "report_schedules_school_id_is_active_idx" ON "report_schedules"("school_id", "is_active");

-- AddForeignKey
ALTER TABLE "board_results" ADD CONSTRAINT "board_results_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_results" ADD CONSTRAINT "board_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_results" ADD CONSTRAINT "board_results_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
