/**
 * Unit tests for the usage_history MCP tool.
 */

import { describe, expect, it, vi } from 'vitest';

import type { QverisClient } from '../api/client.js';
import { executeUsageHistory, usageHistorySchema } from './usage-history.js';

describe('usage_history', () => {
  it('defaults to summary mode', async () => {
    const client = {
      getUsageHistory: vi.fn().mockResolvedValueOnce({
        items: [
          {
            id: 'event-1',
            event_type: 'tool_execute',
            source_system: 'api',
            success: true,
            charge_outcome: 'charged',
            execution_id: 'exec-1',
            tool_id: 'tool-1',
            requested_amount_credits: 12,
            actual_amount_credits: 12,
            created_at: '2026-05-04T10:00:00Z',
          },
          {
            id: 'event-2',
            event_type: 'tool_execute',
            source_system: 'api',
            success: false,
            charge_outcome: 'failed_not_charged',
            execution_id: 'exec-2',
            tool_id: 'tool-2',
            requested_amount_credits: 5,
            actual_amount_credits: 0,
            created_at: '2026-05-04T11:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        page_size: 10,
        summary: {
          start_date: '2026-05-04T00:00:00Z',
          end_date: '2026-05-04T23:59:59Z',
          bucket: 'hour',
          total_count: 2,
          success_count: 1,
          failure_count: 1,
          charge_outcome_counts: {
            charged: 1,
            failed_not_charged: 1,
          },
          pre_settlement_credits: 17,
          settled_credits: 12,
          max_charge_items: [
            {
              id: 'event-1',
              event_type: 'tool_execute',
              source_system: 'api',
              success: true,
              charge_outcome: 'charged',
              execution_id: 'exec-1',
              tool_id: 'tool-1',
              actual_amount_credits: 12,
              created_at: '2026-05-04T10:00:00Z',
            },
          ],
          buckets: [],
        },
      }),
    } as unknown as QverisClient;

    const result = await executeUsageHistory(client, {
      start_date: '2026-05-04',
      end_date: '2026-05-04',
    });

    expect(result.mode).toBe('summary');
    expect(result.total_events).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.actual_amount_credits).toBe(12);
    expect(result.charge_outcomes).toEqual({
      charged: 1,
      failed_not_charged: 1,
    });
    expect(client.getUsageHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: true,
        limit: 10,
      }),
    );
  });

  it('search mode returns capped high-signal rows', async () => {
    const client = {
      getUsageHistory: vi.fn().mockResolvedValueOnce({
        items: [
          {
            id: 'event-1',
            event_type: 'tool_execute',
            source_system: 'api',
            success: true,
            charge_outcome: 'charged',
            execution_id: 'exec-1',
            tool_id: 'tool-1',
            actual_amount_credits: 75,
            created_at: '2026-05-04T10:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 500,
      }),
    } as unknown as QverisClient;

    const result = await executeUsageHistory(client, {
      mode: 'search',
      min_credits: 50,
      limit: 500,
      start_date: '2026-05-04',
      end_date: '2026-05-04',
    });

    expect(result.mode).toBe('search');
    expect(result.shown_records).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        execution_id: 'exec-1',
        actual_amount_credits: 75,
      }),
    ]);
    expect(usageHistorySchema.properties.mode.default).toBe('summary');
  });

  it('applies kind as a client-side safety filter', async () => {
    const client = {
      getUsageHistory: vi.fn().mockResolvedValueOnce({
        items: [
          {
            id: 'event-1',
            event_type: 'tool_execute',
            kind: 'api',
            source_system: 'api',
            success: true,
            charge_outcome: 'charged',
            execution_id: 'exec-1',
            tool_id: 'tool-1',
            actual_amount_credits: 10,
            created_at: '2026-05-04T10:00:00Z',
          },
          {
            id: 'event-2',
            event_type: 'tool_execute',
            kind: 'model',
            source_system: 'api',
            success: true,
            charge_outcome: 'charged',
            execution_id: 'exec-2',
            tool_id: 'tool-2',
            actual_amount_credits: 20,
            created_at: '2026-05-04T11:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        page_size: 500,
      }),
    } as unknown as QverisClient;

    const result = await executeUsageHistory(client, {
      mode: 'search',
      kind: 'api',
      start_date: '2026-05-04',
      end_date: '2026-05-04',
    });

    expect(result.shown_records).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        execution_id: 'exec-1',
        actual_amount_credits: 10,
      }),
    ]);
  });
});
