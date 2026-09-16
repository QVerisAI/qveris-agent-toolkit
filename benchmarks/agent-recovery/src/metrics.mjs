#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = resolve(HERE, '../fixtures/operational-events.v1.json');
const DEFAULT_ALERTS = resolve(HERE, '../config/alerts.v1.json');
const SUBMISSION_OUTCOMES = new Set(['success', 'rejected', 'failed', 'unknown']);
const FINAL_CHARGE_OUTCOMES = new Set(['charged', 'included', 'failed_not_charged', 'failed_charged_review']);
const SUPPORTED_CHARGE_OUTCOMES = new Set([...FINAL_CHARGE_OUTCOMES, 'pending']);
const CHARGE_BEARING_OUTCOMES = new Set(['charged', 'failed_charged_review']);
const SETTLEMENT_ACTIONS = new Set(['reconcile_settlement', 'wait_and_reconcile', 'review_settlement']);
const NEXT_ACTIONS = new Set([
  'none',
  'authenticate',
  'add_credits',
  'request_permission',
  'reconcile_settlement',
  'wait_and_reconcile',
  'review_settlement',
  'correct_parameters',
  'review_request',
  'retry',
  'review_and_retry',
  'select_tool',
  'select_fallback',
  'upgrade_consumer',
  'broaden_discovery',
  'rediscover',
  'inspect_again',
  'probe_again',
  'refresh_quote_or_change_budget_policy',
  'correct_budget_policy',
  'use_server_enforced_capability_budget_or_remove_budget_cap',
  'select_allowed_provider',
  'grant_permission_or_select_provider',
  'rerun_with_allow_side_effects',
  'rerun_with_allow_non_idempotent',
  'provide_parameters',
  'respect_user_denial',
  'select_supported_tool',
]);
const METRIC_DESCRIPTIONS = {
  task_completion_rate:
    'Completed tasks / tasks explicitly eligible to complete under the supplied authority and fixture state.',
  automatic_recovery_success_rate:
    'Tasks completed by automatic recovery / tasks where automatic recovery was attempted.',
  duplicate_call_task_rate:
    'Tasks with more than one submitted Call request / tasks with at least one submitted Call request.',
  duplicate_charge_task_rate:
    'Tasks with more than one distinct charge-bearing final settlement / tasks with at least one charge-bearing final settlement.',
  review_settlement_rate:
    'Submitted Call tasks ending in review_settlement / submitted Call tasks ending in any settlement recovery action.',
  missing_execution_id_rate:
    'Non-rejected submitted Call attempts without execution_id / non-rejected submitted Call attempts.',
  final_settlement_evidence_coverage:
    'Non-rejected submitted Call tasks with final Usage/Ledger evidence for every non-rejected attempt / non-rejected submitted Call tasks.',
};
const SAFETY_METRICS = new Set([
  'duplicate_call_task_rate',
  'duplicate_charge_task_rate',
  'missing_execution_id_rate',
]);
const MIN_METRICS = new Set([
  'task_completion_rate',
  'automatic_recovery_success_rate',
  'final_settlement_evidence_coverage',
]);

function ratioMetric(numerator, denominator, extra = {}) {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
    ...extra,
  };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

function isChargeBearingSettlement(settlement) {
  return settlement.amount_credits > 0 || CHARGE_BEARING_OUTCOMES.has(settlement.charge_outcome);
}

export function validateOperationalDataset(dataset) {
  if (dataset?.schema_version !== 1 || !Array.isArray(dataset.tasks) || dataset.tasks.length === 0) {
    throw new Error('Operational dataset must use schema_version 1 and contain at least one task');
  }
  if (typeof dataset.production_data !== 'boolean') {
    throw new Error('Operational dataset must declare production_data');
  }
  const taskIds = new Set();
  const callIds = new Set();
  const settlementOwners = new Map();
  for (const task of dataset.tasks) {
    if (!nonEmptyString(task?.task_id) || taskIds.has(task.task_id)) {
      throw new Error(`Operational task has an invalid or duplicate task_id: ${task?.task_id ?? '<missing>'}`);
    }
    taskIds.add(task.task_id);
    for (const field of ['completion_eligible', 'completed']) {
      if (typeof task[field] !== 'boolean') throw new Error(`Task ${task.task_id} must declare ${field}`);
    }
    if (task.completed && !task.completion_eligible) {
      throw new Error(`Task ${task.task_id} cannot complete when completion_eligible is false`);
    }
    if (
      typeof task.automatic_recovery?.attempted !== 'boolean' ||
      typeof task.automatic_recovery?.succeeded !== 'boolean'
    ) {
      throw new Error(`Task ${task.task_id} must declare automatic_recovery attempted and succeeded`);
    }
    if (task.automatic_recovery.succeeded && !task.automatic_recovery.attempted) {
      throw new Error(`Task ${task.task_id} cannot succeed automatic recovery without an attempt`);
    }
    if (task.automatic_recovery.succeeded && !task.completed) {
      throw new Error(`Task ${task.task_id} cannot succeed automatic recovery without completing`);
    }
    if (!Array.isArray(task.calls)) throw new Error(`Task ${task.task_id} must declare calls`);
    // Deduplication and conflict detection must have the same task-wide scope.
    const settlementsById = new Map();
    for (const call of task.calls) {
      if (!nonEmptyString(call?.call_id) || callIds.has(call.call_id)) {
        throw new Error(`Task ${task.task_id} has an invalid or duplicate call_id: ${call?.call_id ?? '<missing>'}`);
      }
      callIds.add(call.call_id);
      if (!SUBMISSION_OUTCOMES.has(call.submission_outcome)) {
        throw new Error(`Call ${call.call_id} has an invalid submission_outcome`);
      }
      if (!(call.execution_id === null || nonEmptyString(call.execution_id))) {
        throw new Error(`Call ${call.call_id} must use a non-empty execution_id or null`);
      }
      if (!nonEmptyString(call.next_action) || !NEXT_ACTIONS.has(call.next_action)) {
        throw new Error(`Call ${call.call_id} has an unsupported next_action`);
      }
      if (!Array.isArray(call.settlements)) throw new Error(`Call ${call.call_id} must declare settlements`);
      for (const settlement of call.settlements) {
        if (!nonEmptyString(settlement?.settlement_id)) {
          throw new Error(`Call ${call.call_id} has an invalid settlement_id: ${settlement?.settlement_id ?? '<missing>'}`);
        }
        if (!nonEmptyString(settlement.charge_outcome)) {
          throw new Error(`Settlement ${settlement.settlement_id} must declare charge_outcome`);
        }
        if (!SUPPORTED_CHARGE_OUTCOMES.has(settlement.charge_outcome)) {
          throw new Error(`Settlement ${settlement.settlement_id} has an unsupported charge_outcome`);
        }
        if (!Number.isFinite(settlement.amount_credits) || settlement.amount_credits < 0) {
          throw new Error(`Settlement ${settlement.settlement_id} must declare a non-negative amount_credits`);
        }
        if (call.submission_outcome === 'rejected' && isChargeBearingSettlement(settlement)) {
          throw new Error(`Rejected call ${call.call_id} cannot include a charge-bearing settlement`);
        }
        if (
          !CHARGE_BEARING_OUTCOMES.has(settlement.charge_outcome) &&
          settlement.amount_credits !== 0
        ) {
          throw new Error(`Settlement ${settlement.settlement_id} has an amount inconsistent with charge_outcome`);
        }
        const owner = settlementOwners.get(settlement.settlement_id);
        if (owner && owner !== task.task_id) {
          throw new Error(`Settlement ${settlement.settlement_id} belongs to multiple tasks`);
        }
        settlementOwners.set(settlement.settlement_id, task.task_id);
        const previous = settlementsById.get(settlement.settlement_id);
        if (
          previous &&
          (previous.charge_outcome !== settlement.charge_outcome || previous.amount_credits !== settlement.amount_credits)
        ) {
          throw new Error(`Call ${call.call_id} has conflicting observations for ${settlement.settlement_id}`);
        }
        settlementsById.set(settlement.settlement_id, settlement);
      }
    }
  }
  return dataset;
}

export function validateAlertConfig(config) {
  if (config?.schema_version !== 1 || !config.metrics || typeof config.metrics !== 'object' || Array.isArray(config.metrics)) {
    throw new Error('Alert config must use schema_version 1 and declare metrics');
  }
  for (const name of Object.keys(config.metrics)) {
    if (!Object.hasOwn(METRIC_DESCRIPTIONS, name)) throw new Error(`Unknown alert metric: ${name}`);
  }
  for (const metricName of Object.keys(METRIC_DESCRIPTIONS)) {
    const rule = config.metrics[metricName];
    if (!rule) throw new Error(`Alert config is missing ${metricName}`);
    for (const key of Object.keys(rule)) {
      if (!['direction', 'threshold', 'min_denominator', 'severity'].includes(key)) {
        throw new Error(`Unknown alert rule field: ${metricName}.${key}`);
      }
    }
    if (!['min', 'max'].includes(rule.direction)) throw new Error(`${metricName} must use min or max direction`);
    if (rule.direction !== (MIN_METRICS.has(metricName) ? 'min' : 'max')) {
      throw new Error(`${metricName} has an inverted alert direction`);
    }
    if (!Number.isFinite(rule.threshold) || rule.threshold < 0 || rule.threshold > 1) {
      throw new Error(`${metricName} threshold must be between 0 and 1`);
    }
    if (!Number.isInteger(rule.min_denominator) || rule.min_denominator < 1) {
      throw new Error(`${metricName} min_denominator must be a positive integer`);
    }
    if (!['warning', 'critical'].includes(rule.severity)) {
      throw new Error(`${metricName} severity must be warning or critical`);
    }
    if (
      SAFETY_METRICS.has(metricName) &&
      (rule.threshold !== 0 || rule.min_denominator !== 1 || rule.severity !== 'critical')
    ) {
      throw new Error(`${metricName} must preserve the zero-tolerance safety policy`);
    }
  }
  return config;
}

function distinctChargeBearingSettlements(task) {
  const settlements = new Map();
  for (const call of task.calls) {
    for (const settlement of call.settlements) {
      if (isChargeBearingSettlement(settlement)) settlements.set(settlement.settlement_id, settlement);
    }
  }
  return [...settlements.values()];
}

export function summarizeOperationalTasks(tasks) {
  validateOperationalDataset({ schema_version: 1, production_data: false, tasks });
  const completionEligible = tasks.filter((task) => task.completion_eligible);
  const automaticRecoveryAttempted = tasks.filter((task) => task.automatic_recovery.attempted);
  const submittedTasks = tasks.filter((task) => task.calls.length > 0);
  const duplicateCallTasks = submittedTasks.filter((task) => task.calls.length > 1);
  const chargeBearingTasks = tasks.filter((task) => distinctChargeBearingSettlements(task).length > 0);
  const duplicateChargeTasks = chargeBearingTasks.filter(
    (task) => distinctChargeBearingSettlements(task).length > 1,
  );
  const settlementRecoveryTasks = submittedTasks.filter((task) =>
    SETTLEMENT_ACTIONS.has(task.calls.at(-1).next_action),
  );
  const reviewSettlementTasks = settlementRecoveryTasks.filter(
    (task) => task.calls.at(-1).next_action === 'review_settlement',
  );
  const nonRejectedCalls = tasks.flatMap((task) =>
    task.calls.filter((call) => call.submission_outcome !== 'rejected'),
  );
  const finalEvidenceTasks = submittedTasks.filter((task) => {
    const relevantCalls = task.calls.filter((call) => call.submission_outcome !== 'rejected');
    return (
      relevantCalls.length > 0 &&
      relevantCalls.every((call) =>
        call.settlements.some((settlement) => FINAL_CHARGE_OUTCOMES.has(settlement.charge_outcome)),
      )
    );
  });
  const nonRejectedSubmittedTasks = submittedTasks.filter((task) =>
    task.calls.some((call) => call.submission_outcome !== 'rejected'),
  );

  return {
    task_completion_rate: ratioMetric(
      completionEligible.filter((task) => task.completed).length,
      completionEligible.length,
    ),
    automatic_recovery_success_rate: ratioMetric(
      automaticRecoveryAttempted.filter((task) => task.automatic_recovery.succeeded).length,
      automaticRecoveryAttempted.length,
    ),
    duplicate_call_task_rate: ratioMetric(duplicateCallTasks.length, submittedTasks.length, {
      excess_submitted_calls: submittedTasks.reduce((sum, task) => sum + Math.max(0, task.calls.length - 1), 0),
    }),
    duplicate_charge_task_rate: ratioMetric(duplicateChargeTasks.length, chargeBearingTasks.length, {
      excess_charge_settlements: chargeBearingTasks.reduce(
        (sum, task) => sum + Math.max(0, distinctChargeBearingSettlements(task).length - 1),
        0,
      ),
    }),
    review_settlement_rate: ratioMetric(reviewSettlementTasks.length, settlementRecoveryTasks.length),
    missing_execution_id_rate: ratioMetric(
      nonRejectedCalls.filter((call) => !nonEmptyString(call.execution_id)).length,
      nonRejectedCalls.length,
    ),
    final_settlement_evidence_coverage: ratioMetric(finalEvidenceTasks.length, nonRejectedSubmittedTasks.length),
  };
}

export function evaluateAlerts(metrics, alertConfig) {
  validateAlertConfig(alertConfig);
  const evaluations = {};
  const alerts = [];
  for (const [metricName, description] of Object.entries(METRIC_DESCRIPTIONS)) {
    const metric = metrics[metricName];
    if (
      !metric || !Number.isSafeInteger(metric.numerator) || !Number.isSafeInteger(metric.denominator) ||
      metric.numerator < 0 || metric.denominator < metric.numerator ||
      metric.rate !== (metric.denominator ? metric.numerator / metric.denominator : null)
    ) {
      throw new Error(`Invalid metric counts or rate: ${metricName}`);
    }
    const rule = alertConfig.metrics[metricName];
    const enoughData = metric.denominator >= rule.min_denominator;
    const breached =
      enoughData && (rule.direction === 'min' ? metric.rate < rule.threshold : metric.rate > rule.threshold);
    const status = !enoughData ? 'insufficient_data' : breached ? 'breached' : 'pass';
    evaluations[metricName] = { ...metric, description, ...rule, status };
    if (breached) {
      alerts.push({
        metric: metricName,
        severity: rule.severity,
        direction: rule.direction,
        threshold: rule.threshold,
        numerator: metric.numerator,
        denominator: metric.denominator,
        rate: metric.rate,
      });
    }
  }
  return { evaluations, alerts };
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export function evaluateOperationalMetrics(dataset, alertConfig, sources = {}) {
  validateOperationalDataset(dataset);
  validateAlertConfig(alertConfig);
  const metrics = summarizeOperationalTasks(dataset.tasks);
  const { evaluations, alerts } = evaluateAlerts(metrics, alertConfig);
  return {
    schema_version: 1,
    lane: dataset.production_data ? 'operational_export' : 'controlled_observability_fixture',
    production_success_claim: false,
    sources,
    task_count: dataset.tasks.length,
    metrics: evaluations,
    alert_summary: {
      status: alerts.length > 0
        ? 'alerting'
        : Object.values(evaluations).some((metric) => metric.status === 'insufficient_data')
          ? 'insufficient_data'
          : 'pass',
      alert_count: alerts.length,
      alerts,
    },
  };
}

function argumentValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return resolve(args[index + 1]);
}

function annotationEscape(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

async function main() {
  const args = process.argv.slice(2);
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (!['--input', '--thresholds', '--output', '--fail-on-alert'].includes(flag) || seen.has(flag)) {
      throw new Error(`Unknown or duplicate option: ${flag}`);
    }
    seen.add(flag);
    if (flag !== '--fail-on-alert') {
      argumentValue(args, flag, null);
      i += 1;
    }
  }
  const inputPath = argumentValue(args, '--input', DEFAULT_INPUT);
  const alertsPath = argumentValue(args, '--thresholds', DEFAULT_ALERTS);
  const outputPath = argumentValue(args, '--output', null);
  if (outputPath === inputPath || outputPath === alertsPath) {
    throw new Error('--output must not overwrite an input or threshold file');
  }
  const inputContents = await readFile(inputPath, 'utf8');
  const alertContents = await readFile(alertsPath, 'utf8');
  const result = evaluateOperationalMetrics(JSON.parse(inputContents), JSON.parse(alertContents), {
    events_sha256: sha256(inputContents),
    alerts_sha256: sha256(alertContents),
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, serialized, 'utf8');
  else process.stdout.write(serialized);
  if (args.includes('--fail-on-alert') && result.alert_summary.alert_count > 0) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const alert of result.alert_summary.alerts) {
        const message = `${alert.metric}=${alert.rate} breached ${alert.direction} threshold ${alert.threshold} (${alert.numerator}/${alert.denominator})`;
        process.stderr.write(`::error title=Recovery metric ${annotationEscape(alert.metric)}::${annotationEscape(message)}\n`);
      }
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
