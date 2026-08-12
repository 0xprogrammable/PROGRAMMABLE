import { utf8ByteLength } from "./open-world-v2-primitives.mjs";

export function byteBoundaries(text) {
  const boundaries = new Set([0]);
  let offset = 0;
  for (const character of text) {
    offset += Buffer.byteLength(character, "utf8");
    boundaries.add(offset);
  }
  return boundaries;
}

export function hasLoneSurrogate(text) {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

export function sensitiveCandidates(text) {
  const candidates = [];
  const rules = [
    ["private-key", /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/gu, 0],
    ["private-key-or-secret-hex", /(?:^|[^0-9A-Za-z])((?:0x)?[0-9a-fA-F]{64})(?=$|[^0-9A-Za-z])/gu, 1],
    ["github-access-token", /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/gu, 0],
    ["api-access-token", /(?:sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})/gu, 0],
    ["encoded-access-token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, 0],
    ["explicit-secret-assignment", /\b(?:api(?:[_ -]?key)|secret(?:[_ -]?key)?|access(?:[_ -]?token)|password|private(?:[_ -]?key))\s*[:=]\s*\S{8,}/giu, 0],
    ["seed-phrase", /\b(?:seed|recovery|mnemonic)(?:\s+phrase|\s+words?)?\s*[:=]\s*(?:[a-z]{2,12}\s+){11,23}[a-z]{2,12}\b/giu, 0],
    ["private-pii", /\b(?:social security|ssn|passport|national id|tax id|private email|home address)\s*(?:number)?\s*[:=]\s*\S{4,}/giu, 0],
    ["financial-identifier", /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/gu, 0]
  ];
  for (const [kind, pattern, capture] of rules) {
    for (const match of text.matchAll(pattern)) {
      const matchedText = match[capture];
      const characterStart = capture === 0 ? match.index : match.index + match[0].indexOf(matchedText);
      const characterEnd = characterStart + matchedText.length;
      candidates.push({
        kind,
        startByte: utf8ByteLength(text.slice(0, characterStart)),
        endByte: utf8ByteLength(text.slice(0, characterEnd)),
        text: matchedText
      });
    }
  }
  return candidates.sort((left, right) => left.startByte - right.startByte || left.endByte - right.endByte || left.kind.localeCompare(right.kind));
}

export function hasPublicChainIdentifierContext(text, candidate) {
  const bytes = Buffer.from(text, "utf8");
  const contextStart = Math.max(0, candidate.startByte - 160);
  const before = bytes.subarray(contextStart, candidate.startByte).toString("utf8");
  if (/(?:private|secret|signing|wallet)\s*(?:[_ -]?(?:key|seed))?|mnemonic|recovery\s+phrase|credential|password\s*[:=]?\s*$/iu.test(before)) {
    return false;
  }
  return /(?:\b(?:transaction|tx|pool|block|order|proposal|message|commit|content|artifact|bytecode|runtime|schema|manifest|source|tree|blob|application|submission|receipt|evidence)\s*(?:[_ -]?(?:hash|id|identifier|digest|oid))?|\b(?:bytes32|digest|public\s+(?:chain\s+)?identifier|onchain\s+(?:hash|id|identifier)))\s*(?:[:=#]|\bis\b)?\s*$/iu.test(before);
}
