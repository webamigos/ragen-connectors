/**
 * Test companies for the Rejestr.io contract probe. Goal: cover
 * response diversity in as few companies as possible, so probe runs
 * stay cheap (~4 PLN per full run).
 *
 * TODO(patryk): fill in real KRS numbers. The choice matters — prefer
 * real customers you'd look up in scoring anyway, so the fixtures
 * double as hand-verifiable test cases.
 *
 * Archetypes we want represented:
 *   - a large SA / GPW company         → richest happy-path response
 *   - a small sp. z o.o.               → tests null / missing-field handling
 *   - a wykreślona / upadłość / likw.  → tests insolvency-state flags
 */

export type TestCompany = {
  /**
   * Canonical 10-digit KRS number, zero-padded (e.g. '0000010681').
   *
   * Kept as a string because that's how KRS is written in documents,
   * registers, and anywhere a human sees it — leading zeros matter.
   * The probe strips them (via `toApiKrs()` in probe.ts) only when
   * building URL paths, because Rejestr.io's API wants the integer
   * form.
   */
  krs: string;
  /** NIP (digits only, no dashes). Used to smoke-test endpoint 01 via NIP search. */
  nip: string;
  /** Archetype label — shows up in the probe report. */
  archetype: 'gpw' | 'small-spzoo' | 'insolvent';
  /** Free-text note — why this company was picked. */
  note: string;
};

export const TEST_COMPANIES: TestCompany[] = [
  {
    krs: '0000010681',
    nip: '5260250995',
    archetype: 'gpw',
    note: 'TODO: pick a GPW-listed SA (e.g. one of the WIG20). CD Projekt, Allegro, etc.',
  },
  {
    krs: '0000634215',
    nip: '1132916831',
    archetype: 'small-spzoo',
    note: 'TODO: pick a small sp. z o.o. — ideally one whose financials you already know.',
  },
  {
    krs: '0000458061',
    nip: '',
    archetype: 'insolvent',
    note: 'TODO: pick a company in upadłość / likwidacja / wykreślona to test dead-state handling.',
  },
];
