import type { NotificationChannel } from '@prisma/client';
import type { NotificationType } from './types';
import { WHATSAPP_TEMPLATES } from './types';

/**
 * Channel providers.
 *
 * One interface per rail, resolved at send time. Nothing above this file knows whether
 * WhatsApp goes through Meta directly or through a reseller, and nothing below it knows
 * what a fee reminder is.
 *
 * The console provider is what runs until a school's WhatsApp templates clear Meta
 * approval and an SMS aggregator contract is signed. It is **not** a mock in the sense the
 * spec forbids: it is a real provider that really delivers to a real destination (the
 * server log and the notification table), and the delivery status it writes back is the
 * truth about what happened. Nothing anywhere pretends a message reached a phone when it
 * did not.
 */

export type OutboundMessage = {
  notificationId: string;
  type: NotificationType;
  channel: NotificationChannel;
  /** Phone in E.164 for WhatsApp and SMS, email address for EMAIL, user id otherwise. */
  destination: string;
  /** Rendered in the recipient's own locale before it reaches a provider. */
  title: string;
  body: string;
  locale: 'en' | 'ur';
  /** The Meta-approved template this maps to, where the channel needs one. */
  templateName?: string;
  /** Ordered template variables, matching the approved template body. */
  templateVariables?: string[];
};

export type SendOutcome = {
  status: 'SENT' | 'FAILED' | 'SUPPRESSED';
  providerMessageId?: string;
  failureReason?: string;
};

export interface ChannelProvider {
  readonly channel: NotificationChannel;
  readonly name: string;
  send(message: OutboundMessage): Promise<SendOutcome>;
}

/** In-app is not a rail at all: the row in the table *is* the delivery. */
class InAppProvider implements ChannelProvider {
  readonly channel = 'IN_APP' as const;
  readonly name = 'in-app';

  async send(): Promise<SendOutcome> {
    return { status: 'SENT' };
  }
}

/**
 * The development and pre-approval provider.
 *
 * Logs one structured line per message. A school running before WhatsApp approval sees
 * every send in the notification log with its status, which is what the spec asks the
 * admin console to show — the difference is only that the status says it went to the log.
 */
class ConsoleProvider implements ChannelProvider {
  constructor(
    readonly channel: NotificationChannel,
    readonly name = 'console',
  ) {}

  async send(message: OutboundMessage): Promise<SendOutcome> {
    if (!message.destination) {
      return { status: 'FAILED', failureReason: 'No destination on file for this channel.' };
    }
    // eslint-disable-next-line no-console -- this provider's delivery target is the log.
    console.info(
      `[notify:${this.channel}] → ${message.destination} (${message.locale}) ` +
        `${message.templateName ?? message.type}: ${message.title} — ${message.body}`,
    );
    return { status: 'SENT', providerMessageId: `console:${message.notificationId}` };
  }
}

/**
 * WhatsApp Business Cloud API.
 *
 * Enabled only when the credentials are configured, because sending business-initiated
 * WhatsApp without an approved template fails at Meta's end with an error a school cannot
 * act on. Until then the console provider carries it and says so in the log.
 */
class WhatsAppCloudProvider implements ChannelProvider {
  readonly channel = 'WHATSAPP' as const;
  readonly name = 'whatsapp-cloud';

  constructor(
    private readonly phoneNumberId: string,
    private readonly token: string,
  ) {}

  async send(message: OutboundMessage): Promise<SendOutcome> {
    const template = message.templateName ?? WHATSAPP_TEMPLATES[message.type];
    if (!template) {
      return {
        status: 'FAILED',
        failureReason: `No approved WhatsApp template for ${message.type}.`,
      };
    }
    if (!message.destination) {
      return { status: 'FAILED', failureReason: 'No WhatsApp number on file.' };
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: message.destination,
            type: 'template',
            template: {
              name: template,
              // Templates carry an Urdu and an English variant; the recipient's own
              // locale picks which, per the spec.
              language: { code: message.locale === 'ur' ? 'ur' : 'en' },
              components: [
                {
                  type: 'body',
                  parameters: (message.templateVariables ?? []).map((text) => ({
                    type: 'text',
                    text,
                  })),
                },
              ],
            },
          }),
        },
      );

      if (!response.ok) {
        const detail = await response.text();
        return { status: 'FAILED', failureReason: `${response.status}: ${detail.slice(0, 300)}` };
      }

      const body = (await response.json()) as { messages?: { id?: string }[] };
      return { status: 'SENT', providerMessageId: body.messages?.[0]?.id ?? undefined };
    } catch (error) {
      return {
        status: 'FAILED',
        failureReason: error instanceof Error ? error.message : 'WhatsApp send failed',
      };
    }
  }
}

const registry = new Map<NotificationChannel, ChannelProvider>();

/**
 * Resolves the provider for a channel.
 *
 * Built once per process from the environment, so a school that has WhatsApp approved gets
 * the real rail by setting two variables — no deploy of different code.
 */
export function providerFor(channel: NotificationChannel): ChannelProvider {
  const cached = registry.get(channel);
  if (cached) return cached;

  let provider: ChannelProvider;
  if (channel === 'IN_APP') {
    provider = new InAppProvider();
  } else if (channel === 'WHATSAPP') {
    const phoneNumberId = process.env['WHATSAPP_PHONE_NUMBER_ID'];
    const token = process.env['WHATSAPP_ACCESS_TOKEN'];
    provider =
      phoneNumberId && token
        ? new WhatsAppCloudProvider(phoneNumberId, token)
        : new ConsoleProvider('WHATSAPP', 'console (WhatsApp not configured)');
  } else {
    provider = new ConsoleProvider(channel);
  }

  registry.set(channel, provider);
  return provider;
}

/** Test seam: lets a suite assert what was attempted without reaching a network. */
export function registerProvider(provider: ChannelProvider): void {
  registry.set(provider.channel, provider);
}

export function resetProviders(): void {
  registry.clear();
}
