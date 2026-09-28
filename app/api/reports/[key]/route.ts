import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { buildReport, reportQuerySchema, reportToSheets } from '@/lib/services/reports';
import { REPORT_KEYS, type ReportKey } from '@/lib/services/reports/definitions';
import { buildXlsx } from '@/lib/reports/xlsx';
import { renderReportPdf } from '@/lib/pdf/report';
import { getSchoolConfig } from '@/lib/services/school-settings';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

const formatSchema = z.enum(['json', 'xlsx', 'pdf']).default('json');

/**
 * One report, in one of three formats.
 *
 * "Every report exports to Excel and PDF." Same builder for all three, so the spreadsheet a
 * bursar reconciles against and the PDF a principal takes into a meeting cannot disagree.
 */
export const GET = route<{ key: string }>(
  { module: 'reports' },
  async ({ actor, params, request }) => {
    if (!REPORT_KEYS.includes(params.key as ReportKey)) throw ApiError.notFound('Report not found');
    const key = params.key as ReportKey;

    const url = new URL(request.url);
    const format = formatSchema.parse(url.searchParams.get('format') ?? 'json');
    const query = reportQuerySchema.parse(Object.fromEntries(url.searchParams));

    const report = await buildReport(actor, key, query);

    if (format === 'json') return report;

    const stamp = report.generatedAt.slice(0, 10);

    if (format === 'xlsx') {
      const workbook = buildXlsx(reportToSheets(report));
      return new NextResponse(new Uint8Array(workbook), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${key}-${stamp}.xlsx"`,
        },
      });
    }

    const config = await getSchoolConfig();
    const pdf = await renderReportPdf(report, {
      schoolName: config.settings.branding.displayName || config.name,
      generatedBy: actor.userId,
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${key}-${stamp}.pdf"`,
      },
    });
  },
);
