import { config } from 'dotenv';
config();

import { describe, it, expect } from 'vitest';
import { waitlistSignups, pressMentions, contactSubmissions } from '../../../src/api/db/schema.js';

describe('Public page schema', () => {
  it('exports waitlistSignups table', () => {
    expect(waitlistSignups).toBeDefined();
  });

  it('exports pressMentions table', () => {
    expect(pressMentions).toBeDefined();
  });

  it('exports contactSubmissions table', () => {
    expect(contactSubmissions).toBeDefined();
  });
});
