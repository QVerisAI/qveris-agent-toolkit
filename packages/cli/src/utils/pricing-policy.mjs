const FREE_TEXT_PATTERN = /^\s*(?:free|no[ -]?charge|免费)(?:\s+(?:per|for)\s+[\w -]+)?\s*$/i;
const NUMBER_PATTERN = /(?:^|[^A-Za-z0-9])(-?\d+(?:\.\d+)?)(?=$|[^A-Za-z0-9])/g;
const ZERO_COST_TEXT_PATTERN = /^\s*[$€£¥]?\s*0(?:\.0+)?(?:\s+credits?)?(?:\s+per\s+[\w -]+)?\s*$/i;

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

function monetaryBillingValues(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return [];
  const values = [];
  const visit = (value, key = "") => {
    if (value === null || value === undefined) return;
    if (typeof value !== "object") {
      if (/(?:amount|cost|price|charge|credit)/i.test(key)) values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(rule);
  return values;
}

export function classifyPricing(tool) {
  const signals = [];
  if (tool?.expected_cost !== undefined && tool.expected_cost !== null) signals.push(tool.expected_cost);
  if (tool?.cost !== undefined && tool.cost !== null) signals.push(tool.cost);
  if (tool?.cost_class !== undefined && tool.cost_class !== null) signals.push(tool.cost_class);

  let billingRulePresent = false;
  if (tool?.billing_rule !== undefined && tool.billing_rule !== null) {
    billingRulePresent = true;
    const billingValues = monetaryBillingValues(tool.billing_rule);
    if (billingValues.length > 0) signals.push(...billingValues);
    else signals.push(JSON.stringify(tool.billing_rule));
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
