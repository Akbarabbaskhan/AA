import type { NotificationChannel } from '@prisma/client';

/**
 * Notification types and their defaults.
 *
 * Every type declares which channels it uses by default, whether it is urgent enough to
 * ignore quiet hours, and how it batches. Adding a notification means adding a row here,
 * not touching the delivery code — which is the whole point of a channel-agnostic
 * `notify()`.
 */

export const CHANNELS = ['IN_APP', 'PUSH', 'WHATSAPP', 'SMS', 'EMAIL'] as const;

export type NotificationTypeSpec = {
  /** Channels attempted unless the user has turned one off. */
  defaultChannels: readonly NotificationChannel[];
  /**
   * Urgent types ignore quiet hours. The bar is deliberately high: a fee reminder at
   * 22:30 is how a school teaches parents to mute its messages.
   */
  isUrgent: boolean;
  /**
   * How sends collapse into one message. `DAILY_PER_USER` is what makes "a parent whose
   * child missed four periods gets one message, not four" true.
   */
  batching: 'NONE' | 'DAILY_PER_USER' | 'HOURLY_PER_USER';
  /** Sent to guardians rather than to the student themselves. */
  audience: 'ANY';
};

export const NOTIFICATION_TYPES = {
  'attendance.absent': {
    // The spec's acceptance criterion: a WhatsApp message to the primary guardian,
    // batched with any other absences that day.
    defaultChannels: ['IN_APP', 'WHATSAPP', 'SMS'],
    isUrgent: false,
    batching: 'DAILY_PER_USER',
    audience: 'ANY',
  },
  'attendance.low': {
    defaultChannels: ['IN_APP', 'WHATSAPP'],
    isUrgent: false,
    batching: 'DAILY_PER_USER',
    audience: 'ANY',
  },
  'fee.reminder': {
    defaultChannels: ['IN_APP', 'WHATSAPP', 'SMS'],
    isUrgent: false,
    batching: 'DAILY_PER_USER',
    audience: 'ANY',
  },
  'fee.receipt': {
    // A receipt confirms money has moved. It goes out when it happens, not at 07:00.
    defaultChannels: ['IN_APP', 'WHATSAPP'],
    isUrgent: true,
    batching: 'NONE',
    audience: 'ANY',
  },
  'result.published': {
    defaultChannels: ['IN_APP', 'PUSH', 'WHATSAPP'],
    isUrgent: false,
    batching: 'NONE',
    audience: 'ANY',
  },
  'announcement.published': {
    defaultChannels: ['IN_APP', 'PUSH'],
    isUrgent: false,
    batching: 'HOURLY_PER_USER',
    audience: 'ANY',
  },
  'assignment.due': {
    defaultChannels: ['IN_APP', 'PUSH'],
    isUrgent: false,
    batching: 'DAILY_PER_USER',
    audience: 'ANY',
  },
  'leave.decided': {
    defaultChannels: ['IN_APP', 'WHATSAPP'],
    isUrgent: false,
    batching: 'NONE',
    audience: 'ANY',
  },
  'meeting.booked': {
    defaultChannels: ['IN_APP', 'WHATSAPP'],
    isUrgent: false,
    batching: 'NONE',
    audience: 'ANY',
  },
  'exam.schedule': {
    defaultChannels: ['IN_APP', 'PUSH', 'WHATSAPP'],
    isUrgent: false,
    batching: 'NONE',
    audience: 'ANY',
  },
  'security.alert': {
    // A password change or a new device. Always through, always now.
    defaultChannels: ['IN_APP', 'EMAIL', 'SMS'],
    isUrgent: true,
    batching: 'NONE',
    audience: 'ANY',
  },
} as const satisfies Record<string, NotificationTypeSpec>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const NOTIFICATION_TYPE_NAMES = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export function specFor(type: NotificationType): NotificationTypeSpec {
  return NOTIFICATION_TYPES[type];
}

export function isKnownType(value: string): value is NotificationType {
  return value in NOTIFICATION_TYPES;
}

/**
 * WhatsApp template names, per type.
 *
 * Business-initiated WhatsApp messages can only use templates Meta has pre-approved, and
 * approval takes days to weeks — the spec says to submit them in M1 even though they are
 * sent in M4. Naming them here is what makes the send path a lookup rather than a rewrite
 * once approval lands.
 */
export const WHATSAPP_TEMPLATES: Partial<Record<NotificationType, string>> = {
  'attendance.absent': 'volt_absence_alert',
  'attendance.low': 'volt_low_attendance',
  'fee.reminder': 'volt_fee_reminder',
  'fee.receipt': 'volt_fee_receipt',
  'result.published': 'volt_result_published',
  'announcement.published': 'volt_announcement',
  'exam.schedule': 'volt_exam_schedule',
  // Every type that lists WHATSAPP among its channels needs a name here: a
  // business-initiated message without an approved template is rejected by Meta, and the
  // failure surfaces as an unexplained gap in the delivery log. A unit test enforces it.
  'leave.decided': 'volt_leave_decision',
  'meeting.booked': 'volt_meeting_booked',
};
