/**
 * Name normalization for entity resolution.
 * Cleans and standardizes names for matching against the canonical taxonomy.
 */

const NORMALIZE_MAP: Record<string, string> = {
  "&": "and",
  "Orthopaedic": "Orthopedic",
  "Orthopaedics": "Orthopedics",
  "Assoc.": "Associates",
  "Assoc": "Associates",
  "Med.": "Medicine",
  "Inc.": "Inc",
  "Ltd.": "Ltd",
  "P.C.": "PC",
  "Dept.": "Department",
  "Ctr": "Center",
  "Ctr.": "Center",
  "Hosp": "Hospital",
  "Hosp.": "Hospital",
  "Sys": "System",
  "Sys.": "System",
  "Hlth": "Health",
  "Svc": "Service",
  "Svcs": "Services",
  "Grp": "Group",
  "Grp.": "Group",
  "Natl": "National",
  "Reg": "Regional",
  "Reg.": "Regional",
  "St.": "Saint",
  "Mt.": "Mount",
};

export function normalize(name: string): string {
  let n = name;
  for (const [old, replacement] of Object.entries(NORMALIZE_MAP)) {
    n = n.replace(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replacement);
  }
  n = n.toLowerCase();
  n = n.replace(/[,.()\-\/]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  n = n.replace(/\s+(inc|ltd|llc|pc|psc|pllc|corp|co)$/, "");
  return n;
}

export function extractBaseName(name: string): string {
  const parts = name.split(/\s*[-\u2013\u2014]\s+/);
  let base = parts[0].trim();
  const commaParts = base.split(",");
  if (commaParts.length === 2 && commaParts[1].trim().split(/\s+/).length <= 3) {
    base = commaParts[0].trim();
  }
  return base;
}

export function tokenize(name: string): string[] {
  return normalize(name).split(/\s+/).filter(t => t.length > 0);
}

// Jaccard similarity between two token sets
export function tokenSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Levenshtein distance based similarity (0-100)
export function editSimilarity(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= la; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= lb; j++) {
      matrix[i][j] = i === 0 ? j : 0;
    }
  }

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(la, lb);
  return Math.round((1 - matrix[la][lb] / maxLen) * 100);
}
