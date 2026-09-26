-- CreateEnum
CREATE TYPE "DocumentRequestType" AS ENUM ('TRANSCRIPT', 'RECOMMENDATION', 'CHARACTER_CERTIFICATE');

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'READY', 'DECLINED');

-- AlterEnum
ALTER TYPE "CareerItemType" ADD VALUE 'ALUMNI';

-- CreateTable
CREATE TABLE "document_requests" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "type" "DocumentRequestType" NOT NULL,
    "assigned_to" TEXT,
    "destination" TEXT NOT NULL,
    "note" TEXT,
    "deadline" DATE,
    "status" "DocumentRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "locker_item_id" TEXT,
    "decline_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_requests_locker_item_id_key" ON "document_requests"("locker_item_id");

-- CreateIndex
CREATE INDEX "document_requests_school_id_status_idx" ON "document_requests"("school_id", "status");

-- CreateIndex
CREATE INDEX "document_requests_assigned_to_status_idx" ON "document_requests"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "document_requests_student_id_created_at_idx" ON "document_requests"("student_id", "created_at");

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_locker_item_id_fkey" FOREIGN KEY ("locker_item_id") REFERENCES "document_locker_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
