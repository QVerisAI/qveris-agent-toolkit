/**
 * Unit tests for the credits_ledger MCP tool.
 */

import { describe, expect, it, vi } from 'vitest';

import type { QverisClient } from '../api/client.js';
import { creditsLedgerSchema, executeCreditsLedger } from './credits-ledger.js';

describe('credits_ledger', () => {
  it('defaults to summary mode', async () => {
    const client = {
      getCreditsLedger: vi.fn().mockResolvedValueOnce({
        items: [
          {
            id: 'ledger-1',
            entry_type: 'consume_tool_execute',
            amount_credits: -25,
            source_system: 'api',
            source_ref_type: 'execute_history',
            source_ref_id: 'exec-1',
            created_at: '2026-05-04T10:00:00Z',
          },
          {
            id: 'ledger-2',
            entry_type: 'grant_payment_recharge',
            amount_credits: 100,
            source_system: 'payment',
            source_ref_type: 'payment',
            source_ref_id: 'pay-1',
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
          total_entries: 2,
          consume_count: 1,
          grant_count: 1,
          consumed_credits: 25,
          granted_credits: 100,
          net_amount_credits: 75,
          max_amount_items: [
            {
              id: 'ledger-1',
              entry_type: 'consume_tool_execute',
              amount_credits: -25,
              source_system: 'api',
              source_ref_type: 'execute_history',
              source_ref_id: 'exec-1',
              created_at: '2026-05-04T10:00:00Z',
            },
          ],
          buckets: [],
        },
      }),
    } as unknown as QverisClient;

    const result = await executeCreditsLedger(client, {
      start_date: '2026-05-04',
      end_date: '2026-05-04',
    });

    expect(result.mode).toBe('summary');
    expect(result.total_entries).toBe(2);
    expect(result.consumed_credits).toBe(25);
    expect(result.granted_credits).toBe(100);
    expect(result.net_credits).toBe(75);
    expect(client.getCreditsLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: true,
        limit: 10,
      }),
    );
  });

  it('search mode filters by absolute credit amount and direction', async () => {
    const client = {
      getCreditsLedger: vi.fn().mockResolvedValueOnce({
        items: [
          {
            id: 'ledger-1',
            entry_type: 'consume_tool_execute',
            amount_credits: -75,
            source_system: 'api',
            source_ref_type: 'execute_history',
            source_ref_id: 'exec-1',
            created_at: '2026-05-04T10:00:00Z',
          },
          {
            id: 'ledger-2',
            entry_type: 'grant_payment_recharge',
            amount_credits: 100,
            source_system: 'payment',
            source_ref_type: 'payment',
            source_ref_id: 'pay-1',
            created_at: '2026-05-04T11:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        page_size: 500,
      }),
    } as unknown as QverisClient;

    const result = await executeCreditsLedger(client, {
      mode: 'search',
      direction: 'consume',
      min_credits: 50,
      start_date: '2026-05-04',
      end_date: '2026-05-04',
    });

    expect(result.mode).toBe('search');
    expect(result.shown_records).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        source_ref_id: 'exec-1',
        amount_credits: -75,
      }),
    ]);
    expect(creditsLedgerSchema.properties.mode.default).toBe('summary');
  });
});
