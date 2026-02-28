import { describe, expect, it } from 'vitest';
import {
  detectPackageInstall,
  extractConceptsFromPackage,
  parsePackageFromCommand,
} from '../../src/core/concept-extraction.js';

describe('parsePackageFromCommand', () => {
  it('parses npm install <pkg>', () => {
    expect(parsePackageFromCommand('npm install redis')).toEqual(['redis']);
  });
  it('parses npm i <pkg>', () => {
    expect(parsePackageFromCommand('npm i express')).toEqual(['express']);
  });
  it('parses pip install <pkg>', () => {
    expect(parsePackageFromCommand('pip install flask')).toEqual(['flask']);
  });
  it('parses multiple packages', () => {
    expect(parsePackageFromCommand('npm install redis bullmq')).toEqual(['redis', 'bullmq']);
  });
  it('strips version specifiers', () => {
    expect(parsePackageFromCommand('npm install redis@4.0.0')).toEqual(['redis']);
  });
  it('ignores flags', () => {
    expect(parsePackageFromCommand('npm install -D vitest')).toEqual(['vitest']);
  });
  it('returns empty for non-install commands', () => {
    expect(parsePackageFromCommand('npm test')).toEqual([]);
  });
  it('returns empty for empty string', () => {
    expect(parsePackageFromCommand('')).toEqual([]);
  });

  // Additional coverage for other package managers
  it('parses yarn add <pkg>', () => {
    expect(parsePackageFromCommand('yarn add react')).toEqual(['react']);
  });
  it('parses pnpm add <pkg>', () => {
    expect(parsePackageFromCommand('pnpm add vue')).toEqual(['vue']);
  });
  it('parses pnpm install <pkg>', () => {
    expect(parsePackageFromCommand('pnpm install zod')).toEqual(['zod']);
  });
  it('parses cargo add <pkg>', () => {
    expect(parsePackageFromCommand('cargo add serde')).toEqual(['serde']);
  });
  it('parses go get <pkg>', () => {
    expect(parsePackageFromCommand('go get github.com/gin-gonic/gin')).toEqual(['github.com/gin-gonic/gin']);
  });
  it('parses gem install <pkg>', () => {
    expect(parsePackageFromCommand('gem install rails')).toEqual(['rails']);
  });
  it('parses composer require <pkg>', () => {
    expect(parsePackageFromCommand('composer require laravel/framework')).toEqual(['laravel/framework']);
  });
  it('parses pip3 install <pkg>', () => {
    expect(parsePackageFromCommand('pip3 install numpy')).toEqual(['numpy']);
  });
  it('strips pip version specifiers', () => {
    expect(parsePackageFromCommand('pip install flask>=2.0')).toEqual(['flask']);
  });
  it('handles scoped npm packages', () => {
    expect(parsePackageFromCommand('npm install @anthropic-ai/sdk')).toEqual(['@anthropic-ai/sdk']);
  });
  it('handles --save-dev flag', () => {
    expect(parsePackageFromCommand('npm install --save-dev jest')).toEqual(['jest']);
  });
});

describe('detectPackageInstall', () => {
  it('detects npm install', () => {
    expect(detectPackageInstall('npm install redis')).toBe(true);
  });
  it('detects npm i', () => {
    expect(detectPackageInstall('npm i express')).toBe(true);
  });
  it('detects npm add', () => {
    expect(detectPackageInstall('npm add lodash')).toBe(true);
  });
  it('detects yarn add', () => {
    expect(detectPackageInstall('yarn add react')).toBe(true);
  });
  it('detects pnpm add', () => {
    expect(detectPackageInstall('pnpm add vue')).toBe(true);
  });
  it('detects pnpm install with package', () => {
    expect(detectPackageInstall('pnpm install zod')).toBe(true);
  });
  it('detects pip install', () => {
    expect(detectPackageInstall('pip install flask')).toBe(true);
  });
  it('detects pip3 install', () => {
    expect(detectPackageInstall('pip3 install numpy')).toBe(true);
  });
  it('detects cargo add', () => {
    expect(detectPackageInstall('cargo add serde')).toBe(true);
  });
  it('detects go get', () => {
    expect(detectPackageInstall('go get github.com/gin-gonic/gin')).toBe(true);
  });
  it('detects gem install', () => {
    expect(detectPackageInstall('gem install rails')).toBe(true);
  });
  it('detects composer require', () => {
    expect(detectPackageInstall('composer require laravel/framework')).toBe(true);
  });
  it('does not detect unrelated commands', () => {
    expect(detectPackageInstall('git commit -m "test"')).toBe(false);
  });
  it('does not detect npm test', () => {
    expect(detectPackageInstall('npm test')).toBe(false);
  });
  it('does not detect empty string', () => {
    expect(detectPackageInstall('')).toBe(false);
  });
});

describe('extractConceptsFromPackage', () => {
  it('maps redis to caching concepts', () => {
    const concepts = extractConceptsFromPackage('redis');
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.name.toLowerCase().includes('cach') || c.name.toLowerCase().includes('redis'))).toBe(true);
  });
  it('maps express to web framework concepts', () => {
    const concepts = extractConceptsFromPackage('express');
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.domain === 'web-development')).toBe(true);
  });
  it('maps prisma to ORM/database concepts', () => {
    const concepts = extractConceptsFromPackage('prisma');
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.domain === 'databases')).toBe(true);
  });
  it('maps react to frontend concepts', () => {
    const concepts = extractConceptsFromPackage('react');
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.domain === 'frontend')).toBe(true);
  });
  it('maps zod to validation concepts', () => {
    const concepts = extractConceptsFromPackage('zod');
    expect(concepts.length).toBeGreaterThan(0);
  });
  it('maps jsonwebtoken to auth concepts', () => {
    const concepts = extractConceptsFromPackage('jsonwebtoken');
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.domain === 'security')).toBe(true);
  });
  it('maps vitest to testing concepts', () => {
    const concepts = extractConceptsFromPackage('vitest');
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.domain === 'testing')).toBe(true);
  });
  it('maps numpy to data-science concepts', () => {
    const concepts = extractConceptsFromPackage('numpy');
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.domain === 'data-science')).toBe(true);
  });
  it('maps @anthropic-ai/sdk to AI concepts', () => {
    const concepts = extractConceptsFromPackage('@anthropic-ai/sdk');
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some(c => c.domain === 'ai')).toBe(true);
  });
  it('maps unknown package to empty', () => {
    expect(extractConceptsFromPackage('some-random-unknown-pkg-xyz')).toEqual([]);
  });
  it('returns concepts with correct structure', () => {
    const concepts = extractConceptsFromPackage('redis');
    for (const c of concepts) {
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('specificity');
      expect(c).toHaveProperty('confidence');
      expect(c).toHaveProperty('extractionSignal', 'package');
      expect(['domain', 'topic', 'technique']).toContain(c.specificity);
      expect(c.confidence).toBeGreaterThan(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });
});
