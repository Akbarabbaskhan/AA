-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('STUDENT', 'PARENT', 'TEACHER', 'HOD', 'ADMIN', 'BURSAR', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'GRADUATED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEAVE');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BehaviourType" AS ENUM ('MERIT', 'DEMERIT');

-- CreateEnum
CREATE TYPE "ExamSeriesType" AS ENUM ('TEST', 'MONTHLY', 'MID_TERM', 'MOCK', 'FINAL');

-- CreateEnum
CREATE TYPE "PredictionMethod" AS ENUM ('TEACHER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('NOTES', 'SLIDES', 'WORKSHEET', 'VIDEO_LINK', 'OTHER');

-- CreateEnum
CREATE TYPE "ResourceVisibility" AS ENUM ('MY_SECTIONS', 'YEAR_GROUP', 'WHOLE_SCHOOL');

-- CreateEnum
CREATE TYPE "PaperSession" AS ENUM ('MAY_JUNE', 'OCT_NOV', 'FEB_MARCH');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'MULTI', 'SHORT', 'NUMERIC');

-- CreateEnum
CREATE TYPE "FeeFrequency" AS ENUM ('MONTHLY', 'TERMLY', 'ANNUAL', 'ONE_OFF');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK', 'JAZZCASH', 'EASYPAISA', 'CARD', 'CHEQUE');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'WHATSAPP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "SocietyMemberRole" AS ENUM ('MEMBER', 'HEAD', 'SECRETARY', 'TREASURER');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('GOING', 'NOT_GOING', 'WAITLIST');

-- CreateEnum
CREATE TYPE "CareerItemType" AS ENUM ('DEADLINE', 'SCHOLARSHIP', 'RESOURCE', 'EVENT');

-- CreateEnum
CREATE TYPE "ImportJobType" AS ENUM ('STUDENTS', 'GUARDIANS', 'STAFF', 'SUBJECTS', 'MARKS', 'QUESTIONS');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'VALIDATING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BookingSlotType" AS ENUM ('PARENT_TEACHER', 'COUNSELLOR');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('OPEN', 'BOOKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "schools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "favicon_url" TEXT,
    "theme_json" JSONB NOT NULL DEFAULT '{}',
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "address" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "scope_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "roll_number" TEXT NOT NULL,
    "gsm_number" TEXT,
    "admission_number" TEXT NOT NULL,
    "date_of_birth" DATE,
    "gender" "Gender",
    "admission_date" DATE,
    "house" TEXT,
    "photo_url" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "opt_out_leaderboards" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "occupation" TEXT,
    "cnic" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_students" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "receives_alerts" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "designation" TEXT,
    "department_id" TEXT,
    "joining_date" DATE,
    "qualifications" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hod_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programmes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_groups" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "programme_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "year_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "programme_id" TEXT NOT NULL,
    "department_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "colour" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_components" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "weight_percent" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subject_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "year_group_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teacher_id" TEXT,
    "room_id" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrolments" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dropped_at" TIMESTAMP(3),

    CONSTRAINT "enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "type" TEXT NOT NULL DEFAULT 'classroom',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_slots" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "period_index" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "room_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substitutions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "timetable_slot_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "original_staff_id" TEXT,
    "cover_staff_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "period_index" INTEGER NOT NULL,
    "marked_by_staff_id" TEXT,
    "marked_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "minutes_late" INTEGER,
    "note" TEXT,
    "amended_by_staff_id" TEXT,
    "amended_at" TIMESTAMP(3),
    "amend_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "document_url" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behaviour_notes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "type" "BehaviourType" NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "body" TEXT NOT NULL,
    "is_visible_to_parent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behaviour_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_series" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ExamSeriesType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "exam_series_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "subject_component_id" TEXT,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total_marks" INTEGER NOT NULL,
    "weight_percent" INTEGER NOT NULL,
    "grading_scale_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "marks_obtained" INTEGER,
    "is_absent" BOOLEAN NOT NULL DEFAULT false,
    "entered_by" TEXT,
    "entered_at" TIMESTAMP(3),
    "moderated_by" TEXT,
    "moderated_at" TIMESTAMP(3),
    "original_marks" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_scales" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "bands_json" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grading_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_cards" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "exam_series_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_url" TEXT,
    "published_at" TIMESTAMP(3),
    "aggregate_json" JSONB NOT NULL,

    CONSTRAINT "result_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predicted_grades" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "method" "PredictionMethod" NOT NULL,
    "confidence" INTEGER,
    "set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "predicted_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "topic_tags" TEXT[],
    "visibility" "ResourceVisibility" NOT NULL DEFAULT 'MY_SECTIONS',
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "past_papers" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "component_id" TEXT,
    "board" TEXT NOT NULL,
    "session" "PaperSession" NOT NULL,
    "year" INTEGER NOT NULL,
    "variant" INTEGER NOT NULL,
    "paper_url" TEXT NOT NULL,
    "mark_scheme_url" TEXT,
    "examiner_report_url" TEXT,
    "duration_minutes" INTEGER,
    "total_marks" INTEGER,
    "difficulty" INTEGER,
    "topic_tags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "past_papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_collections" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_collection_items" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "past_paper_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "paper_collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_attempts" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "past_paper_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "self_marked_score" INTEGER,
    "total" INTEGER,
    "time_taken_seconds" INTEGER,
    "notes" TEXT,

    CONSTRAINT "paper_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "attachments_json" JSONB NOT NULL DEFAULT '[]',
    "due_at" TIMESTAMP(3) NOT NULL,
    "total_marks" INTEGER NOT NULL,
    "allow_late" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "files_json" JSONB NOT NULL DEFAULT '[]',
    "text_body" TEXT,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "marks" INTEGER,
    "feedback" TEXT,
    "graded_by" TEXT,
    "graded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "time_limit_seconds" INTEGER,
    "attempts_allowed" INTEGER NOT NULL DEFAULT 1,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT true,
    "shuffle_options" BOOLEAN NOT NULL DEFAULT true,
    "negative_marking" BOOLEAN NOT NULL DEFAULT false,
    "available_from" TIMESTAMP(3),
    "available_to" TIMESTAMP(3),
    "show_answers_after" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "body" TEXT NOT NULL,
    "options_json" JSONB NOT NULL DEFAULT '[]',
    "correct_json" JSONB NOT NULL,
    "marks" INTEGER NOT NULL DEFAULT 1,
    "negative_marks" INTEGER NOT NULL DEFAULT 0,
    "topic_tag" TEXT,
    "difficulty" INTEGER,
    "explanation" TEXT,
    "tolerance_bp" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" TEXT NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "score" INTEGER,
    "tab_switches" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_answers" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "answer_json" JSONB NOT NULL,
    "is_correct" BOOLEAN,
    "marks_awarded" INTEGER,
    "needs_manual_marking" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "quiz_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_mastery" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "topic_tag" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_mastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_topics" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parent_id" TEXT,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syllabus_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_coverage" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "syllabus_topic_id" TEXT NOT NULL,
    "covered_at" TIMESTAMP(3) NOT NULL,
    "marked_by" TEXT NOT NULL,

    CONSTRAINT "syllabus_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doubt_threads" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "resource_id" TEXT,
    "student_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "answered_by" TEXT,
    "answered_at" TIMESTAMP(3),
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doubt_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doubt_replies" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doubt_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_heads" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT true,
    "default_amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "year_group_id" TEXT NOT NULL,
    "heads_json" JSONB NOT NULL,
    "frequency" "FeeFrequency" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "line_items_json" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "voucher_number" TEXT NOT NULL,
    "voucher_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "recorded_by" TEXT,
    "gateway_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience_json" JSONB NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "allow_replies" BOOLEAN NOT NULL DEFAULT false,
    "publish_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "societies" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "staff_advisor_id" TEXT,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "societies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "society_members" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "society_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "role" "SocietyMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "society_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "society_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "capacity" INTEGER,
    "rsvp_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_rsvps" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "RsvpStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_rsvps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_items" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "type" "CareerItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "institution" TEXT,
    "body" TEXT,
    "deadline" DATE,
    "link" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_badges" (
    "id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_points" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "student_id" TEXT,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "awarded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "house_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_locker_items" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_locker_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_slots" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "type" "BookingSlotType" NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'OPEN',
    "booked_by_user_id" TEXT,
    "student_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "failure_reason" TEXT,
    "batch_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "impersonated_by_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "type" "ImportJobType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "mapping_json" JSONB NOT NULL DEFAULT '{}',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_report_url" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result_json" JSONB,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schools_slug_key" ON "schools"("slug");

-- CreateIndex
CREATE INDEX "academic_years_school_id_is_current_idx" ON "academic_years"("school_id", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_school_id_label_key" ON "academic_years"("school_id", "label");

-- CreateIndex
CREATE INDEX "users_school_id_is_active_idx" ON "users"("school_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "users_school_id_email_key" ON "users"("school_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_school_id_phone_key" ON "users"("school_id", "phone");

-- CreateIndex
CREATE INDEX "user_roles_school_id_role_idx" ON "user_roles"("school_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_key" ON "user_roles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_account_id_key" ON "oauth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "otp_tokens_user_id_purpose_idx" ON "otp_tokens"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "impersonation_sessions_school_id_started_at_idx" ON "impersonation_sessions"("school_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

-- CreateIndex
CREATE INDEX "students_school_id_status_idx" ON "students"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_admission_number_key" ON "students"("school_id", "admission_number");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_roll_number_key" ON "students"("school_id", "roll_number");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_user_id_key" ON "guardians"("user_id");

-- CreateIndex
CREATE INDEX "guardians_school_id_idx" ON "guardians"("school_id");

-- CreateIndex
CREATE INDEX "guardian_students_student_id_is_primary_idx" ON "guardian_students"("student_id", "is_primary");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_students_guardian_id_student_id_key" ON "guardian_students"("guardian_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_id_key" ON "staff"("user_id");

-- CreateIndex
CREATE INDEX "staff_school_id_department_id_idx" ON "staff"("school_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_school_id_employee_code_key" ON "staff"("school_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_school_id_name_key" ON "departments"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "programmes_school_id_name_key" ON "programmes"("school_id", "name");

-- CreateIndex
CREATE INDEX "year_groups_school_id_order_idx" ON "year_groups"("school_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "year_groups_school_id_name_key" ON "year_groups"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_school_id_programme_id_code_key" ON "subjects"("school_id", "programme_id", "code");

-- CreateIndex
CREATE INDEX "subject_components_school_id_idx" ON "subject_components"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_components_subject_id_code_key" ON "subject_components"("subject_id", "code");

-- CreateIndex
CREATE INDEX "sections_school_id_academic_year_id_idx" ON "sections"("school_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "sections_teacher_id_academic_year_id_idx" ON "sections"("teacher_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_school_id_academic_year_id_name_key" ON "sections"("school_id", "academic_year_id", "name");

-- CreateIndex
CREATE INDEX "enrolments_school_id_academic_year_id_idx" ON "enrolments"("school_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "enrolments_section_id_dropped_at_idx" ON "enrolments"("section_id", "dropped_at");

-- CreateIndex
CREATE UNIQUE INDEX "enrolments_student_id_section_id_key" ON "enrolments"("student_id", "section_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_school_id_name_key" ON "rooms"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "periods_school_id_index_key" ON "periods"("school_id", "index");

-- CreateIndex
CREATE INDEX "holidays_school_id_academic_year_id_idx" ON "holidays"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_school_id_academic_year_id_date_key" ON "holidays"("school_id", "academic_year_id", "date");

-- CreateIndex
CREATE INDEX "timetable_slots_school_id_academic_year_id_day_of_week_idx" ON "timetable_slots"("school_id", "academic_year_id", "day_of_week");

-- CreateIndex
CREATE INDEX "timetable_slots_room_id_day_of_week_period_index_idx" ON "timetable_slots"("room_id", "day_of_week", "period_index");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_slots_section_id_day_of_week_period_index_key" ON "timetable_slots"("section_id", "day_of_week", "period_index");

-- CreateIndex
CREATE INDEX "substitutions_school_id_date_idx" ON "substitutions"("school_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "substitutions_timetable_slot_id_date_key" ON "substitutions"("timetable_slot_id", "date");

-- CreateIndex
CREATE INDEX "attendance_sessions_section_id_date_idx" ON "attendance_sessions"("section_id", "date");

-- CreateIndex
CREATE INDEX "attendance_sessions_school_id_academic_year_id_date_idx" ON "attendance_sessions"("school_id", "academic_year_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_section_id_date_period_index_key" ON "attendance_sessions"("section_id", "date", "period_index");

-- CreateIndex
CREATE INDEX "attendance_records_student_id_status_idx" ON "attendance_records"("student_id", "status");

-- CreateIndex
CREATE INDEX "attendance_records_school_id_academic_year_id_idx" ON "attendance_records"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_student_id_key" ON "attendance_records"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "leave_requests_school_id_status_idx" ON "leave_requests"("school_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_student_id_from_date_idx" ON "leave_requests"("student_id", "from_date");

-- CreateIndex
CREATE INDEX "behaviour_notes_student_id_created_at_idx" ON "behaviour_notes"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "behaviour_notes_school_id_idx" ON "behaviour_notes"("school_id");

-- CreateIndex
CREATE INDEX "exam_series_school_id_academic_year_id_idx" ON "exam_series"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_series_school_id_academic_year_id_name_key" ON "exam_series"("school_id", "academic_year_id", "name");

-- CreateIndex
CREATE INDEX "assessments_school_id_academic_year_id_idx" ON "assessments"("school_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "assessments_exam_series_id_section_id_idx" ON "assessments"("exam_series_id", "section_id");

-- CreateIndex
CREATE INDEX "marks_assessment_id_idx" ON "marks"("assessment_id");

-- CreateIndex
CREATE INDEX "marks_school_id_academic_year_id_idx" ON "marks"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "marks_student_id_assessment_id_key" ON "marks"("student_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_scales_school_id_name_key" ON "grading_scales"("school_id", "name");

-- CreateIndex
CREATE INDEX "result_cards_school_id_exam_series_id_idx" ON "result_cards"("school_id", "exam_series_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_cards_student_id_exam_series_id_key" ON "result_cards"("student_id", "exam_series_id");

-- CreateIndex
CREATE INDEX "predicted_grades_school_id_academic_year_id_idx" ON "predicted_grades"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "predicted_grades_student_id_subject_id_academic_year_id_met_key" ON "predicted_grades"("student_id", "subject_id", "academic_year_id", "method");

-- CreateIndex
CREATE UNIQUE INDEX "resources_supersedes_id_key" ON "resources"("supersedes_id");

-- CreateIndex
CREATE INDEX "resources_school_id_subject_id_idx" ON "resources"("school_id", "subject_id");

-- CreateIndex
CREATE INDEX "resources_topic_tags_idx" ON "resources" USING GIN ("topic_tags");

-- CreateIndex
CREATE INDEX "past_papers_school_id_subject_id_year_idx" ON "past_papers"("school_id", "subject_id", "year");

-- CreateIndex
CREATE INDEX "past_papers_topic_tags_idx" ON "past_papers" USING GIN ("topic_tags");

-- CreateIndex
CREATE UNIQUE INDEX "past_papers_school_id_subject_id_component_id_year_session__key" ON "past_papers"("school_id", "subject_id", "component_id", "year", "session", "variant");

-- CreateIndex
CREATE INDEX "paper_collections_school_id_idx" ON "paper_collections"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_collection_items_collection_id_past_paper_id_key" ON "paper_collection_items"("collection_id", "past_paper_id");

-- CreateIndex
CREATE INDEX "paper_attempts_student_id_submitted_at_idx" ON "paper_attempts"("student_id", "submitted_at");

-- CreateIndex
CREATE INDEX "paper_attempts_school_id_past_paper_id_idx" ON "paper_attempts"("school_id", "past_paper_id");

-- CreateIndex
CREATE INDEX "assignments_school_id_section_id_idx" ON "assignments"("school_id", "section_id");

-- CreateIndex
CREATE INDEX "assignments_section_id_due_at_idx" ON "assignments"("section_id", "due_at");

-- CreateIndex
CREATE INDEX "submissions_school_id_assignment_id_idx" ON "submissions"("school_id", "assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_assignment_id_student_id_key" ON "submissions"("assignment_id", "student_id");

-- CreateIndex
CREATE INDEX "quizzes_school_id_section_id_idx" ON "quizzes"("school_id", "section_id");

-- CreateIndex
CREATE INDEX "questions_school_id_subject_id_idx" ON "questions"("school_id", "subject_id");

-- CreateIndex
CREATE INDEX "questions_topic_tag_idx" ON "questions"("topic_tag");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_questions_quiz_id_question_id_key" ON "quiz_questions"("quiz_id", "question_id");

-- CreateIndex
CREATE INDEX "quiz_attempts_quiz_id_student_id_idx" ON "quiz_attempts"("quiz_id", "student_id");

-- CreateIndex
CREATE INDEX "quiz_attempts_school_id_submitted_at_idx" ON "quiz_attempts"("school_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_answers_attempt_id_question_id_key" ON "quiz_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "topic_mastery_school_id_subject_id_idx" ON "topic_mastery"("school_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "topic_mastery_student_id_subject_id_topic_tag_key" ON "topic_mastery"("student_id", "subject_id", "topic_tag");

-- CreateIndex
CREATE INDEX "syllabus_topics_school_id_subject_id_idx" ON "syllabus_topics"("school_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_topics_subject_id_code_key" ON "syllabus_topics"("subject_id", "code");

-- CreateIndex
CREATE INDEX "syllabus_coverage_school_id_academic_year_id_idx" ON "syllabus_coverage"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_coverage_section_id_syllabus_topic_id_key" ON "syllabus_coverage"("section_id", "syllabus_topic_id");

-- CreateIndex
CREATE INDEX "doubt_threads_school_id_subject_id_idx" ON "doubt_threads"("school_id", "subject_id");

-- CreateIndex
CREATE INDEX "doubt_replies_thread_id_idx" ON "doubt_replies"("thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_heads_school_id_name_key" ON "fee_heads"("school_id", "name");

-- CreateIndex
CREATE INDEX "fee_structures_school_id_academic_year_id_idx" ON "fee_structures"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_school_id_academic_year_id_year_group_id_fre_key" ON "fee_structures"("school_id", "academic_year_id", "year_group_id", "frequency");

-- CreateIndex
CREATE INDEX "invoices_student_id_status_idx" ON "invoices"("student_id", "status");

-- CreateIndex
CREATE INDEX "invoices_school_id_academic_year_id_status_idx" ON "invoices"("school_id", "academic_year_id", "status");

-- CreateIndex
CREATE INDEX "invoices_school_id_due_date_idx" ON "invoices"("school_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_school_id_voucher_number_key" ON "invoices"("school_id", "voucher_number");

-- CreateIndex
CREATE INDEX "payments_school_id_paid_at_idx" ON "payments"("school_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_school_id_invoice_id_idx" ON "credit_notes"("school_id", "invoice_id");

-- CreateIndex
CREATE INDEX "discounts_school_id_student_id_idx" ON "discounts"("school_id", "student_id");

-- CreateIndex
CREATE INDEX "announcements_school_id_publish_at_idx" ON "announcements"("school_id", "publish_at");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reads_announcement_id_user_id_key" ON "announcement_reads"("announcement_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "societies_school_id_name_key" ON "societies"("school_id", "name");

-- CreateIndex
CREATE INDEX "society_members_school_id_idx" ON "society_members"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "society_members_society_id_student_id_key" ON "society_members"("society_id", "student_id");

-- CreateIndex
CREATE INDEX "events_school_id_starts_at_idx" ON "events"("school_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_rsvps_school_id_idx" ON "event_rsvps"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_rsvps_event_id_user_id_key" ON "event_rsvps"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "career_items_school_id_deadline_idx" ON "career_items"("school_id", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "badges_school_id_code_key" ON "badges"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "student_badges_badge_id_student_id_key" ON "student_badges"("badge_id", "student_id");

-- CreateIndex
CREATE INDEX "house_points_school_id_house_idx" ON "house_points"("school_id", "house");

-- CreateIndex
CREATE INDEX "document_locker_items_school_id_user_id_idx" ON "document_locker_items"("school_id", "user_id");

-- CreateIndex
CREATE INDEX "booking_slots_school_id_starts_at_idx" ON "booking_slots"("school_id", "starts_at");

-- CreateIndex
CREATE INDEX "booking_slots_staff_id_status_idx" ON "booking_slots"("staff_id", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_school_id_delivery_status_idx" ON "notifications"("school_id", "delivery_status");

-- CreateIndex
CREATE INDEX "notifications_batch_key_idx" ON "notifications"("batch_key");

-- CreateIndex
CREATE INDEX "notification_preferences_school_id_idx" ON "notification_preferences"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_type_channel_key" ON "notification_preferences"("user_id", "type", "channel");

-- CreateIndex
CREATE INDEX "audit_logs_school_id_entity_type_entity_id_idx" ON "audit_logs"("school_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_school_id_actor_user_id_created_at_idx" ON "audit_logs"("school_id", "actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_school_id_created_at_idx" ON "audit_logs"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "import_jobs_school_id_status_idx" ON "import_jobs"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "processed_events_source_external_id_key" ON "processed_events"("source", "external_id");

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_tokens" ADD CONSTRAINT "otp_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_students" ADD CONSTRAINT "guardian_students_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_students" ADD CONSTRAINT "guardian_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_hod_staff_id_fkey" FOREIGN KEY ("hod_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "year_groups" ADD CONSTRAINT "year_groups_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "year_groups" ADD CONSTRAINT "year_groups_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_components" ADD CONSTRAINT "subject_components_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_year_group_id_fkey" FOREIGN KEY ("year_group_id") REFERENCES "year_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_timetable_slot_id_fkey" FOREIGN KEY ("timetable_slot_id") REFERENCES "timetable_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_original_staff_id_fkey" FOREIGN KEY ("original_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_cover_staff_id_fkey" FOREIGN KEY ("cover_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_marked_by_staff_id_fkey" FOREIGN KEY ("marked_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_amended_by_staff_id_fkey" FOREIGN KEY ("amended_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_notes" ADD CONSTRAINT "behaviour_notes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_notes" ADD CONSTRAINT "behaviour_notes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_notes" ADD CONSTRAINT "behaviour_notes_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_exam_series_id_fkey" FOREIGN KEY ("exam_series_id") REFERENCES "exam_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_subject_component_id_fkey" FOREIGN KEY ("subject_component_id") REFERENCES "subject_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_grading_scale_id_fkey" FOREIGN KEY ("grading_scale_id") REFERENCES "grading_scales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_moderated_by_fkey" FOREIGN KEY ("moderated_by") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_scales" ADD CONSTRAINT "grading_scales_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_cards" ADD CONSTRAINT "result_cards_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_cards" ADD CONSTRAINT "result_cards_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_cards" ADD CONSTRAINT "result_cards_exam_series_id_fkey" FOREIGN KEY ("exam_series_id") REFERENCES "exam_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predicted_grades" ADD CONSTRAINT "predicted_grades_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predicted_grades" ADD CONSTRAINT "predicted_grades_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predicted_grades" ADD CONSTRAINT "predicted_grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predicted_grades" ADD CONSTRAINT "predicted_grades_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predicted_grades" ADD CONSTRAINT "predicted_grades_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "past_papers" ADD CONSTRAINT "past_papers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "past_papers" ADD CONSTRAINT "past_papers_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "past_papers" ADD CONSTRAINT "past_papers_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "subject_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_collection_items" ADD CONSTRAINT "paper_collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "paper_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_collection_items" ADD CONSTRAINT "paper_collection_items_past_paper_id_fkey" FOREIGN KEY ("past_paper_id") REFERENCES "past_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_attempts" ADD CONSTRAINT "paper_attempts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_attempts" ADD CONSTRAINT "paper_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_attempts" ADD CONSTRAINT "paper_attempts_past_paper_id_fkey" FOREIGN KEY ("past_paper_id") REFERENCES "past_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "syllabus_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_coverage" ADD CONSTRAINT "syllabus_coverage_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_coverage" ADD CONSTRAINT "syllabus_coverage_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_coverage" ADD CONSTRAINT "syllabus_coverage_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_coverage" ADD CONSTRAINT "syllabus_coverage_syllabus_topic_id_fkey" FOREIGN KEY ("syllabus_topic_id") REFERENCES "syllabus_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_coverage" ADD CONSTRAINT "syllabus_coverage_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doubt_threads" ADD CONSTRAINT "doubt_threads_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doubt_threads" ADD CONSTRAINT "doubt_threads_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doubt_threads" ADD CONSTRAINT "doubt_threads_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doubt_threads" ADD CONSTRAINT "doubt_threads_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doubt_threads" ADD CONSTRAINT "doubt_threads_answered_by_fkey" FOREIGN KEY ("answered_by") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doubt_replies" ADD CONSTRAINT "doubt_replies_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "doubt_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_year_group_id_fkey" FOREIGN KEY ("year_group_id") REFERENCES "year_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "societies" ADD CONSTRAINT "societies_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "societies" ADD CONSTRAINT "societies_staff_advisor_id_fkey" FOREIGN KEY ("staff_advisor_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "society_members" ADD CONSTRAINT "society_members_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "society_members" ADD CONSTRAINT "society_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_items" ADD CONSTRAINT "career_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badges" ADD CONSTRAINT "badges_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_badges" ADD CONSTRAINT "student_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_badges" ADD CONSTRAINT "student_badges_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_points" ADD CONSTRAINT "house_points_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_points" ADD CONSTRAINT "house_points_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_locker_items" ADD CONSTRAINT "document_locker_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_locker_items" ADD CONSTRAINT "document_locker_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
