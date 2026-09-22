import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  GLOBAL_MODELS,
  TENANCY_BY_PARENT,
  TENANT_SCOPED_MODELS,
  unaccountedModels,
} from '@/lib/db/tenant-models';

describe('tenancy: schema-level guard', () => {
  it('accounts for every model in the schema', () => {
    // Fails when someone adds a model without school_id and without recording why it is
    // safe. That is the whole point of this test: the decision has to be written down.
    expect(unaccountedModels()).toEqual([]);
  });

  it('marks every model carrying school_id as tenant-scoped', () => {
    const withSchoolId = Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === 'schoolId'))
      .map((model) => model.name);

    for (const name of withSchoolId) {
      expect(TENANT_SCOPED_MODELS.has(name)).toBe(true);
    }
    expect(withSchoolId.length).toBeGreaterThan(40);
  });

  it('gives every parented model a parent that is itself tenant-scoped', () => {
    for (const [child, parent] of Object.entries(TENANCY_BY_PARENT)) {
      expect(
        TENANT_SCOPED_MODELS.has(parent),
        `${child} is parented to ${parent}, which is not tenant-scoped`,
      ).toBe(true);
    }
  });

  it('scopes the academic tables to an academic year as well as a school', () => {
    // Rolling over to a new year must not require touching last year's data.
    const mustBeYearScoped = [
      'Section',
      'Enrolment',
      'TimetableSlot',
      'AttendanceSession',
      'AttendanceRecord',
      'ExamSeries',
      'Assessment',
      'Mark',
      'Invoice',
      'FeeStructure',
    ];

    for (const name of mustBeYearScoped) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
      expect(model, `${name} is missing from the schema`).toBeDefined();
      expect(
        model?.fields.some((field) => field.name === 'academicYearId'),
        `${name} must carry academic_year_id`,
      ).toBe(true);
    }
  });

  it('keeps every money field an integer', () => {
    // "Every amount is stored in integer paisa, never floating point."
    const moneyFields = [
      ['FeeHead', 'defaultAmount'],
      ['Invoice', 'total'],
      ['Invoice', 'discount'],
      ['Payment', 'amount'],
      ['CreditNote', 'amount'],
      ['Discount', 'value'],
    ] as const;

    for (const [modelName, fieldName] of moneyFields) {
      const field = Prisma.dmmf.datamodel.models
        .find((m) => m.name === modelName)
        ?.fields.find((f) => f.name === fieldName);
      expect(field?.type, `${modelName}.${fieldName} must be Int paisa`).toBe('Int');
    }

    const floats = Prisma.dmmf.datamodel.models.flatMap((model) =>
      model.fields
        .filter((field) => field.type === 'Float' || field.type === 'Decimal')
        .map((field) => `${model.name}.${field.name}`),
    );
    expect(floats).toEqual([]);
  });

  it('soft-deletes the entities that carry history', () => {
    for (const name of ['Student', 'Staff', 'Assignment', 'Resource']) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
      expect(
        model?.fields.some((field) => field.name === 'deletedAt'),
        `${name} must soft-delete`,
      ).toBe(true);
    }
  });

  it('leaves only the genuinely global tables unscoped', () => {
    expect([...GLOBAL_MODELS].sort()).toEqual(['ProcessedEvent', 'School']);
  });
});
