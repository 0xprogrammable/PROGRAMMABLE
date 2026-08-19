export const MAX_STATIC_JAVASCRIPT_TOKENS = 100_000;
export const MAX_STATIC_JAVASCRIPT_DEPTH = 64;
export const MAX_STATIC_JAVASCRIPT_STRING_LENGTH = 2_000_000;
export const STATIC_JAVASCRIPT_ANALYSIS_FAILED = "STATIC_JAVASCRIPT_ANALYSIS_FAILED";
export const STATIC_JAVASCRIPT_RESOURCE_LIMIT = "STATIC_JAVASCRIPT_RESOURCE_LIMIT";
export const STATIC_EXPRESSION_START_KEYWORDS = new Set(["case", "default", "return", "throw", "yield"]);
export const STATIC_EXPRESSION_START_PUNCTUATORS = new Set(["=", "(", "[", "{", ",", ":", ";", "?", "=>"]);
export const STATIC_EXPRESSION_END_PUNCTUATORS = new Set([",", ";", ")", "]", "}", ":", "?"]);
export const REGULAR_EXPRESSION_START_KEYWORDS = new Set(["await", "case", "delete", "do", "else", "in", "instanceof", "new", "of", "return", "throw", "typeof", "void", "yield"]);
export const REGULAR_EXPRESSION_START_PUNCTUATORS = new Set(["(", "[", "{", ",", ":", ";", "=", "!", "?", "&", "|", "+", "-", "*", "%", "^", "~", "<", ">"]);
export function staticJavascriptAnalysisIssue(error) {
  return error?.code === STATIC_JAVASCRIPT_RESOURCE_LIMIT
    ? STATIC_JAVASCRIPT_RESOURCE_LIMIT
    : STATIC_JAVASCRIPT_ANALYSIS_FAILED;
}

export function staticJavascriptResourceLimit(message) {
  const error = new Error(message);
  error.code = STATIC_JAVASCRIPT_RESOURCE_LIMIT;
  return error;
}
