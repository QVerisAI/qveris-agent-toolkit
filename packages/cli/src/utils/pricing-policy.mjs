const FREE_TEXT_PATTERN = /^\s*(?:free|no[ -]?charge|免费)(?:\s+(?:per|for)\s+[\w -]+)?\s*$/i;
const NUMBER_PATTERN = /(?:^|[^A-Za-z0-9])(-?\d+(?:\.\d+)?)(?=$|[^A-Za-z0-9])/g;
const ZERO_COST_TEXT_PATTERN = /^\s*[$€£¥]?\s*0(?:\.0+)?(?:\s+credits?)?(?:\s+per\s+[\w -]+)?\s*$/i;
const MONETARY_FIELD_PATTERN = /(?:amount|cost|price|charge|credit|rate|fee)/i;
const BILLING_DESCRIPTOR_FIELDS = new Set(["unit", "currency", "metering_mode", "billing_mode"]);

function classifyScalar(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return "risk";
    return value === 0 ? "free" : "risk";
  }
  if (typeof value !== "string" || value.trim().length === 0) return "risk";
  const numbers = [...value.matchAll(NUMBER_PATTERN)].map((match) => Number(match[1])).filter(Number.isFinite);
  if (numbers.some((amount) => amount > 0)) return "risk";
  if (numbers.some((amount) => amount < 0)) return "risk";
  if (FREE_TEXT_PATTERN.test(value)) return "free";
  if (numbers.length > 0 && numbers.every((amount) => amount === 0) && ZERO_COST_TEXT_PATTERN.test(value)) {
    return "free";
  }
  return "risk";
}

function analyzeBillingRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    return { values: [], complete: false };
  }
  const values = [];
  let complete = true;
  const pending = [{ value: rule, key: "" }];
  while (pending.length > 0) {
    const { value, key } = pending.pop();
    if (value === null || value === undefined) {
      complete = false;
      continue;
    }
    if (Array.isArray(value)) {
      if (key && !MONETARY_FIELD_PATTERN.test(key)) complete = false;
      if (value.length === 0) complete = false;
      for (const item of value) pending.push({ value: item, key: "" });
      continue;
    }
    if (typeof value === "object") {
      if (key && !MONETARY_FIELD_PATTERN.test(key)) complete = false;
      const entries = Object.entries(value);
      if (entries.length === 0) complete = false;
      for (const [childKey, child] of entries) pending.push({ value: child, key: childKey });
      continue;
    }
    if (MONETARY_FIELD_PATTERN.test(key)) {
      values.push(value);
    } else if (!BILLING_DESCRIPTOR_FIELDS.has(key)) {
      complete = false;
    }
  }
  return { values, complete: complete && values.length > 0 };
}

export function classifyPricing(tool) {
  const signals = [];
  if (tool?.expected_cost !== undefined && tool.expected_cost !== null) signals.push(tool.expected_cost);
  if (tool?.cost !== undefined && tool.cost !== null) signals.push(tool.cost);
  if (tool?.cost_class !== undefined && tool.cost_class !== null) signals.push(tool.cost_class);

  let billingRulePresent = false;
  if (tool?.billing_rule !== undefined && tool.billing_rule !== null) {
    billingRulePresent = true;
    const billing = analyzeBillingRule(tool.billing_rule);
    signals.push(...billing.values);
    if (!billing.complete) signals.push("unparsed billing rule");
  }

  if (signals.length === 0) return { status: "absent", requiresQuote: false };
  const verdicts = signals.map(classifyScalar);
  if (verdicts.some((verdict) => verdict === "risk")) {
    return { status: "paid_or_uncertain", requiresQuote: true };
  }
  return { status: "free", requiresQuote: false, billingRulePresent };
}

export function validateQuote(quote) {
  if (
    !quote ||
    typeof quote !== "object" ||
    quote.currency !== "credits" ||
    typeof quote.exact !== "boolean" ||
    typeof quote.estimate_credits !== "number" ||
    !Number.isFinite(quote.estimate_credits) ||
    quote.estimate_credits < 0
  ) {
    return { valid: false, reason: "malformed" };
  }
  return { valid: true, amount: quote.estimate_credits, exact: quote.exact };
}
