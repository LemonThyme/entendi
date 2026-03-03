import { closeSync, fstatSync, openSync, readSync } from 'fs';

const TAIL_BYTES = 50 * 1024; // Read last 50KB of transcript

function readTail(path: string): string {
  try {
    const fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(stat.size, TAIL_BYTES));
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

function parseLines(raw: string): any[] {
  return raw.split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Check if the content of a user message entry is an actual user-typed message
 * (string or array with text blocks), as opposed to tool_result feedback.
 */
function isRealUserMessage(entry: any): boolean {
  if (entry.type !== 'user') return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) {
    // If first block is tool_result, this is tool feedback, not a real user message
    return content.length > 0 && content[0].type !== 'tool_result';
  }
  return false;
}

function extractUserText(entry: any): string {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.find((b: any) => b.type === 'text');
    return text?.text ?? '';
  }
  return '';
}

export function hasObserveCallInCurrentTurn(transcriptPath: string): boolean {
  const raw = readTail(transcriptPath);
  if (!raw) return false;
  const lines = parseLines(raw);

  // Find the last real user message index
  let lastUserIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isRealUserMessage(lines[i])) {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) return false;

  // Scan from last user message onward for observe calls
  for (let i = lastUserIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.type !== 'assistant') continue;
    const content = line?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && typeof block.name === 'string' && block.name.includes('entendi_observe')) {
        // Verify the observe call succeeded by checking its tool_result
        const toolUseId = block.id;
        if (toolUseId && isObserveCallFailed(lines, i, toolUseId)) {
          continue; // Treat failed observe as not called
        }
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a tool_use was followed by a tool_result with is_error=true.
 */
function isObserveCallFailed(lines: any[], afterIdx: number, toolUseId: string): boolean {
  for (let i = afterIdx + 1; i < lines.length; i++) {
    const content = lines[i]?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id === toolUseId) {
        return block.is_error === true;
      }
    }
  }
  return false; // No result found — assume success (in-progress)
}

export function findLastUserMessage(transcriptPath: string): string {
  const raw = readTail(transcriptPath);
  if (!raw) return '';
  const lines = parseLines(raw);

  for (let i = lines.length - 1; i >= 0; i--) {
    if (isRealUserMessage(lines[i])) {
      return extractUserText(lines[i]);
    }
  }

  return '';
}
