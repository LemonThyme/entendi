import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';
import type { ConceptSpecificity, ExtractedConcept } from '../schemas/types.js';

// Re-export the ExtractedConcept type with ast signal for convenience
export type ASTExtractedConcept = ExtractedConcept & { extractionSignal: 'ast' };

export type SupportedLanguage = 'typescript' | 'javascript' | 'python';

// --- Parser initialization ---

let initPromise: Promise<void> | null = null;

/**
 * Initialize the web-tree-sitter parser runtime.
 * Safe to call multiple times; the init is cached.
 */
export async function initParser(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  return initPromise;
}

// --- Language loading & caching ---

const languageCache = new Map<string, Language>();

/**
 * Resolve the path to a .wasm grammar file using multiple strategies.
 */
function resolveWasmPath(grammarPackage: string, wasmFileName: string): string | null {
  const candidates: string[] = [];

  // Strategy 1: Relative to this module file
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(thisDir, '..', '..', 'node_modules', grammarPackage, wasmFileName));
  } catch {
    // import.meta.url may not resolve in all environments
  }

  // Strategy 2: Relative to process.cwd()
  candidates.push(resolve(process.cwd(), 'node_modules', grammarPackage, wasmFileName));

  // Strategy 3: Common npm locations (monorepo root, etc.)
  candidates.push(resolve(process.cwd(), '..', 'node_modules', grammarPackage, wasmFileName));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const LANGUAGE_WASM_MAP: Record<SupportedLanguage, { pkg: string; file: string }> = {
  typescript: { pkg: 'tree-sitter-typescript', file: 'tree-sitter-typescript.wasm' },
  javascript: { pkg: 'tree-sitter-javascript', file: 'tree-sitter-javascript.wasm' },
  python: { pkg: 'tree-sitter-python', file: 'tree-sitter-python.wasm' },
};

async function loadLanguage(lang: SupportedLanguage): Promise<Language | null> {
  if (languageCache.has(lang)) {
    return languageCache.get(lang)!;
  }

  const wasmInfo = LANGUAGE_WASM_MAP[lang];
  if (!wasmInfo) return null;

  const wasmPath = resolveWasmPath(wasmInfo.pkg, wasmInfo.file);
  if (!wasmPath) {
    console.error(`[entendi/ast] Could not locate ${wasmInfo.file} for language '${lang}'`);
    return null;
  }

  try {
    const language = await Language.load(wasmPath);
    languageCache.set(lang, language);
    return language;
  } catch (err) {
    console.error(`[entendi/ast] Failed to load grammar for '${lang}':`, err);
    return null;
  }
}

// --- Pattern detection ---

interface PatternDetector {
  /** Node types to search for in the AST */
  nodeTypes: string[];
  /** Concept name to emit */
  conceptName: string;
  /** Concept specificity */
  specificity: ConceptSpecificity;
  /** Detection confidence */
  confidence: number;
}

/**
 * Pattern detectors for TypeScript and JavaScript.
 * These languages share the same grammar structure for most constructs.
 */
const TS_JS_DETECTORS: PatternDetector[] = [
  {
    nodeTypes: ['await_expression'],
    conceptName: 'async-programming',
    specificity: 'topic',
    confidence: 0.9,
  },
  {
    nodeTypes: ['type_parameters'],
    conceptName: 'generics',
    specificity: 'technique',
    confidence: 0.9,
  },
  {
    nodeTypes: ['generator_function_declaration', 'generator_function', 'yield_expression'],
    conceptName: 'iterators-generators',
    specificity: 'technique',
    confidence: 0.9,
  },
  {
    nodeTypes: ['try_statement'],
    conceptName: 'error-handling',
    specificity: 'topic',
    confidence: 0.8,
  },
  {
    nodeTypes: ['class_declaration', 'abstract_class_declaration'],
    conceptName: 'oop',
    specificity: 'topic',
    confidence: 0.85,
  },
  {
    nodeTypes: ['object_pattern', 'array_pattern'],
    conceptName: 'destructuring',
    specificity: 'technique',
    confidence: 0.85,
  },
  {
    nodeTypes: ['decorator'],
    conceptName: 'decorators-metaprogramming',
    specificity: 'technique',
    confidence: 0.9,
  },
];

/**
 * Pattern detectors for Python.
 * Python uses different node type names for similar constructs.
 */
const PYTHON_DETECTORS: PatternDetector[] = [
  {
    nodeTypes: ['await'],
    conceptName: 'async-programming',
    specificity: 'topic',
    confidence: 0.9,
  },
  {
    nodeTypes: ['type_parameter'],
    conceptName: 'generics',
    specificity: 'technique',
    confidence: 0.9,
  },
  {
    nodeTypes: ['generator_expression', 'yield'],
    conceptName: 'iterators-generators',
    specificity: 'technique',
    confidence: 0.9,
  },
  {
    nodeTypes: ['try_statement'],
    conceptName: 'error-handling',
    specificity: 'topic',
    confidence: 0.8,
  },
  {
    nodeTypes: ['class_definition'],
    conceptName: 'oop',
    specificity: 'topic',
    confidence: 0.85,
  },
  {
    nodeTypes: ['list_pattern', 'dict_pattern', 'tuple_pattern'],
    conceptName: 'destructuring',
    specificity: 'technique',
    confidence: 0.85,
  },
  {
    nodeTypes: ['decorator'],
    conceptName: 'decorators-metaprogramming',
    specificity: 'technique',
    confidence: 0.9,
  },
];

function getDetectors(lang: SupportedLanguage): PatternDetector[] {
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return TS_JS_DETECTORS;
    case 'python':
      return PYTHON_DETECTORS;
  }
}

// --- Main extraction function ---

/**
 * Extract programming concepts from source code using AST analysis.
 *
 * Parses the source with tree-sitter and searches for known patterns
 * (async/await, generics, error handling, OOP, etc.).
 *
 * Returns deduplicated ExtractedConcept objects with extractionSignal='ast'.
 *
 * @param source - The source code string to analyze
 * @param language - The programming language of the source
 * @returns Array of extracted concepts, or [] if parsing fails
 */
export async function extractConceptsFromSource(
  source: string,
  language: SupportedLanguage,
): Promise<ASTExtractedConcept[]> {
  if (!source.trim()) return [];

  // Ensure parser is initialized
  await initParser();

  const lang = await loadLanguage(language);
  if (!lang) return [];

  const detectors = getDetectors(language);

  let parser: Parser | null = null;
  try {
    parser = new Parser();
    parser.setLanguage(lang);

    const tree = parser.parse(source);
    if (!tree) return [];

    try {
      const root = tree.rootNode;
      const seen = new Set<string>();
      const results: ASTExtractedConcept[] = [];

      for (const detector of detectors) {
        if (seen.has(detector.conceptName)) continue;

        const matches = root.descendantsOfType(detector.nodeTypes);
        if (matches.length > 0) {
          seen.add(detector.conceptName);
          results.push({
            name: detector.conceptName,
            specificity: detector.specificity,
            confidence: detector.confidence,
            extractionSignal: 'ast',
          });
        }
      }

      return results;
    } finally {
      tree.delete();
    }
  } catch (err) {
    console.error(`[entendi/ast] Error parsing source as '${language}':`, err);
    return [];
  } finally {
    parser?.delete();
  }
}
