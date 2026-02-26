// src/core/probe-token.ts
import { createHmac, randomUUID } from 'crypto';

export interface ProbeToken {
  tokenId: string;
  userId: string;
  conceptId: string;
  depth: number;
  evaluationCriteria: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface CreateProbeTokenInput {
  userId: string;
  conceptId: string;
  depth: number;
  evaluationCriteria: string;
  secret: string;
  ttlMs: number;
}

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: 'invalid_signature' | 'expired' | 'user_mismatch' | 'concept_mismatch' };

function computeSignature(token: Omit<ProbeToken, 'signature'>, secret: string): string {
  const payload = `${token.tokenId}:${token.userId}:${token.conceptId}:${token.depth}:${token.issuedAt}:${token.expiresAt}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createProbeToken(input: CreateProbeTokenInput): ProbeToken {
  const now = new Date();
  const tokenData = {
    tokenId: randomUUID(),
    userId: input.userId,
    conceptId: input.conceptId,
    depth: input.depth,
    evaluationCriteria: input.evaluationCriteria,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
  };
  return { ...tokenData, signature: computeSignature(tokenData, input.secret) };
}

export function verifyProbeToken(
  token: ProbeToken,
  secret: string,
  constraints?: { userId?: string; conceptId?: string },
): VerifyResult {
  // 1. Check signature
  const expected = computeSignature(token, secret);
  if (token.signature !== expected) {
    return { valid: false, reason: 'invalid_signature' };
  }
  // 2. Check expiry
  if (new Date(token.expiresAt).getTime() <= Date.now()) {
    return { valid: false, reason: 'expired' };
  }
  // 3. Check userId
  if (constraints?.userId && token.userId !== constraints.userId) {
    return { valid: false, reason: 'user_mismatch' };
  }
  // 4. Check conceptId
  if (constraints?.conceptId && token.conceptId !== constraints.conceptId) {
    return { valid: false, reason: 'concept_mismatch' };
  }
  return { valid: true };
}
