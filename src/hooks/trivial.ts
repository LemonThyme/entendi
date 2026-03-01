const TRIVIAL_PATTERNS = [
  /^(yes|no|ok|okay|sure|yep|yup|nah|nope|thanks|thank you|ty|thx|do it|go ahead|sounds good|lgtm|ship it|commit|push|deploy|done|agreed|correct|right|exactly|perfect|great|nice|cool|awesome|got it|understood|continue|proceed)[\s.!?,]*$/i,
];

export function isTrivialMessage(msg: string): boolean {
  const trimmed = msg.trim();
  if (trimmed.length < 15) return true;
  return TRIVIAL_PATTERNS.some(p => p.test(trimmed));
}
