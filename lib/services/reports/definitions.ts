import type { Capability } from '@/lib/permissions';

/**
 * The six reports the spec names, and who each one is for.
 *
 * A report is a definition rather than a page: the key, the audience, the capability that
 * gates it, and the sheets it produces. The screen, the Excel export, the PDF and the
 * scheduled email all read the same definition, so a report cannot look one way on screen and
 * another way in a principal's inbox.
 */

export const REPORT_KEYS = [
  'daily-attendance',
  'academic-performance',
  'fee-collection',
  'at-risk',
  'teacher-activity',
  'board-results',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export type ReportDefinition = {
  key: ReportKey;
  /** Any one of these opens the report. */
  capabilities: readonly Capability[];
  /** Whether the report takes a date, an exam series, or a board session. */
  parameter: 'date' | 'examSeries' | 'boardSession' | 'none';
};

export const REPORT_DEFINITIONS: Readonly<Record<ReportKey, ReportDefinition>> = Object.freeze({
  'daily-attendance': {
    key: 'daily-attendance',
    capabilities: ['attendance.read.school'],
    parameter: 'date',
  },
  'academic-performance': {
    key: 'academic-performance',
    capabilities: ['report.school', 'report.department'],
    parameter: 'examSeries',
  },
  'fee-collection': {
    key: 'fee-collection',
    capabilities: ['fee.read.school', 'report.finance'],
    parameter: 'none',
  },
  'at-risk': {
    key: 'at-risk',
    // A coordinator's list. It combines attendance, grades, submissions and fees, so it needs
    // the campus-wide academic scope — a head of department must not get the fee column.
    capabilities: ['report.school'],
    parameter: 'none',
  },
  'teacher-activity': {
    key: 'teacher-activity',
    capabilities: ['report.school'],
    parameter: 'none',
  },
  'board-results': {
    key: 'board-results',
    capabilities: ['report.school'],
    parameter: 'boardSession',
  },
});
