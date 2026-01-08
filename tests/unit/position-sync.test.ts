/**
 * Position Sync and Import Unit Tests
 * Tests for syncing positions with exchange and importing external positions
 */

import { syncPositions } from '../../src/services/position/position-manager';
import type { Position, ScalperConfig } from '../../src/types';
import type { AsterClient } from '../../src/services/execution/exchange-client';

// =============================================================================
// TEST DATA
// =============================================================================

const defaultConfig: ScalperConfig = {
  leverage: 10,
  positionSizePercent: 35,
  positionSizeUSD: null,
  minPositionSizeUSD: 10,
  maxPositionSizeUSD: 150,
  maxExposurePercent: 80,
  maxPositions: 20,
  riskPerTradePercent: 2,
  maxDailyLossPercent: 10,
  maxDrawdownPercent: 20,
  dailyProfitTargetPercent: 0,
  tickIntervalMs: 15000,
  scanIntervalTicks: 2,
  maxHoldTimeMinutes: 5,
  takeProfitROE: 1.5,
  stopLossROE: -0.4,
  minProfitUSD: 0.2,
  trailingActivationROE: 0.5,
  trailingDistanceROE: 0.2,
  minIvishXConfidence: 5,
  minCombinedConfidence: 55,
  requireLLMAgreement: false,
  minConfidenceWithoutLLM: 50,
  minScoreForSignal: 50,
  rsiPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 65,
  momentumPeriod: 3,
  minMomentum: 0.2,
  maxMomentum: 3.0,
  volumePeriod: 20,
  minVolumeRatio: 0.3,
  trendSMAFast: 10,
  trendSMASlow: 20,
  klineInterval: '5m',
  klineCount: 60,
  llmEnabled: false,
  llmConfidenceBoost: 15,
  llmExitAnalysisEnabled: false,
  llmExitAnalysisMinutes: 2,
  llmExitConfidenceThreshold: 80,
  bounceDetectionEnabled: true,
  bounceRSIThreshold: 35,
  bounceStochThreshold: 25,
  bounceWilliamsThreshold: -75,
  bounceMinGreenCandles: 2,
  bounceBonusPoints: 20,
};

function createTestPosition(symbol: string, overrides: Partial<Position> = {}): Position {
  return {
    id: `test-pos-${symbol}`,
    agentId: 'test-agent',
    userId: 'test-user',
    symbol,
    side: 'long',
    size: 0.001,
    entryPrice: 50000,
    currentPrice: 50000,
    leverage: 10,
    marginUsed: 5,
    unrealizedPnl: 0,
    unrealizedROE: 0,
    highestROE: 0,
    lowestROE: 0,
    stopLoss: null,
    takeProfit: null,
    trailingActivated: false,
    trailingStopPrice: null,
    ivishxConfidence: 7,
    llmConfidence: 65,
    entryReason: ['Test entry'],
    openedAt: Date.now(),
    updatedAt: Date.now(),
    maxHoldTime: 5 * 60 * 1000,
    ...overrides,
  };
}

function createMockClient(exchangePositions: any[]): AsterClient {
  return {
    getPositions: jest.fn().mockResolvedValue(exchangePositions),
  } as any;
}

// =============================================================================
// POSITION SYNC TESTS
// =============================================================================

describe('syncPositions', () => {
  describe('Basic Sync Functionality', () => {
    test('should return empty arrays when no positions exist', async () => {
      const client = createMockClient([]);
      const localPositions = new Map<string, Position>();

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.synced).toEqual([]);
      expect(result.closed).toEqual([]);
      expect(result.opened).toEqual([]);
      expect(result.imported).toEqual([]);
    });

    test('should sync existing local positions that are still on exchange', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();
      localPositions.set('BTCUSDT', createTestPosition('BTCUSDT'));

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.synced).toContain('BTCUSDT');
      expect(result.closed).toEqual([]);
      expect(result.opened).toEqual([]);
      expect(localPositions.has('BTCUSDT')).toBe(true);
    });

    test('should detect positions closed externally', async () => {
      const client = createMockClient([]); // No positions on exchange
      const localPositions = new Map<string, Position>();
      localPositions.set('BTCUSDT', createTestPosition('BTCUSDT'));
      localPositions.set('ETHUSDT', createTestPosition('ETHUSDT'));

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.closed).toContain('BTCUSDT');
      expect(result.closed).toContain('ETHUSDT');
      expect(localPositions.size).toBe(0);
    });

    test('should remove closed positions from local map', async () => {
      const client = createMockClient([]);
      const localPositions = new Map<string, Position>();
      localPositions.set('BTCUSDT', createTestPosition('BTCUSDT'));

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(localPositions.has('BTCUSDT')).toBe(false);
    });
  });

  describe('Position Import', () => {
    test('should import external long position', async () => {
      const exchangePositions = [
        {
          symbol: 'BTCUSDT',
          positionAmt: '0.001',
          entryPrice: '50000',
          leverage: '10',
          unrealizedProfit: '5',
        },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.imported).toContain('BTCUSDT');
      expect(result.opened).toContain('BTCUSDT');
      expect(localPositions.has('BTCUSDT')).toBe(true);

      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.side).toBe('long');
      expect(imported.size).toBe(0.001);
      expect(imported.entryPrice).toBe(50000);
      expect(imported.isExternal).toBe(true);
    });

    test('should import external short position', async () => {
      const exchangePositions = [
        {
          symbol: 'ETHUSDT',
          positionAmt: '-0.5',
          entryPrice: '2000',
          leverage: '10',
          unrealizedProfit: '-10',
        },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.imported).toContain('ETHUSDT');
      const imported = localPositions.get('ETHUSDT')!;
      expect(imported.side).toBe('short');
      expect(imported.size).toBe(0.5);
    });

    test('should calculate margin correctly for imported positions', async () => {
      const exchangePositions = [
        {
          symbol: 'BTCUSDT',
          positionAmt: '0.001',
          entryPrice: '50000',
          leverage: '10',
          unrealizedProfit: '5',
        },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      // Margin = (size * entryPrice) / leverage = (0.001 * 50000) / 10 = 5
      expect(imported.marginUsed).toBe(5);
    });

    test('should calculate ROE correctly for imported positions', async () => {
      const exchangePositions = [
        {
          symbol: 'BTCUSDT',
          positionAmt: '0.001',
          entryPrice: '50000',
          leverage: '10',
          unrealizedProfit: '1',
        },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      // ROE = (unrealizedPnl / margin) * 100 = (1 / 5) * 100 = 20%
      expect(imported.unrealizedROE).toBe(20);
      expect(imported.highestROE).toBe(20);
      expect(imported.lowestROE).toBe(20);
    });

    test('should handle missing leverage (default to 10)', async () => {
      const exchangePositions = [
        {
          symbol: 'BTCUSDT',
          positionAmt: '0.001',
          entryPrice: '50000',
          unrealizedProfit: '5',
        },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.leverage).toBe(10);
    });

    test('should import multiple external positions', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
        { symbol: 'ETHUSDT', positionAmt: '0.5', entryPrice: '2000', leverage: '10', unrealizedProfit: '10' },
        { symbol: 'BNBUSDT', positionAmt: '-1.0', entryPrice: '300', leverage: '10', unrealizedProfit: '-5' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.imported).toHaveLength(3);
      expect(result.imported).toContain('BTCUSDT');
      expect(result.imported).toContain('ETHUSDT');
      expect(result.imported).toContain('BNBUSDT');
      expect(localPositions.size).toBe(3);
    });

    test('should set correct fields for imported positions', async () => {
      const exchangePositions = [
        {
          symbol: 'BTCUSDT',
          positionAmt: '0.001',
          entryPrice: '50000',
          leverage: '15',
          unrealizedProfit: '7.5',
        },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.agentId).toBe('test-agent');
      expect(imported.isExternal).toBe(true);
      expect(imported.symbol).toBe('BTCUSDT');
      expect(imported.originalSize).toBe(0.001);
      expect(imported.currentPrice).toBe(50000); // Set to entry initially
      expect(imported.openedAt).toBeDefined();
      expect(imported.updatedAt).toBeDefined();
    });
  });

  describe('Mixed Sync Scenarios', () => {
    test('should sync existing and import new positions', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
        { symbol: 'ETHUSDT', positionAmt: '0.5', entryPrice: '2000', leverage: '10', unrealizedProfit: '10' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();
      localPositions.set('BTCUSDT', createTestPosition('BTCUSDT'));

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.synced).toContain('BTCUSDT');
      expect(result.imported).toContain('ETHUSDT');
      expect(localPositions.size).toBe(2);
    });

    test('should sync existing, close some, and import new positions', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
        { symbol: 'BNBUSDT', positionAmt: '1.0', entryPrice: '300', leverage: '10', unrealizedProfit: '3' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();
      localPositions.set('BTCUSDT', createTestPosition('BTCUSDT'));
      localPositions.set('ETHUSDT', createTestPosition('ETHUSDT')); // Will be closed

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.synced).toContain('BTCUSDT');
      expect(result.closed).toContain('ETHUSDT');
      expect(result.imported).toContain('BNBUSDT');
      expect(localPositions.size).toBe(2);
      expect(localPositions.has('BTCUSDT')).toBe(true);
      expect(localPositions.has('ETHUSDT')).toBe(false);
      expect(localPositions.has('BNBUSDT')).toBe(true);
    });

    test('should not re-import already local positions', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();
      const originalPosition = createTestPosition('BTCUSDT');
      localPositions.set('BTCUSDT', originalPosition);

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      expect(result.synced).toContain('BTCUSDT');
      expect(result.imported).toEqual([]);
      // Should keep original position object
      expect(localPositions.get('BTCUSDT')).toBe(originalPosition);
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero position amounts gracefully', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0', entryPrice: '50000', leverage: '10', unrealizedProfit: '0' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      // Zero positions should still be imported (exchange might return them)
      expect(result.imported).toContain('BTCUSDT');
      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.size).toBe(0);
    });

    test('should handle negative position amounts for shorts', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '-0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.side).toBe('short');
      expect(imported.size).toBe(0.001); // Absolute value
    });

    test('should handle API errors gracefully', async () => {
      const client = {
        getPositions: jest.fn().mockRejectedValue(new Error('API error')),
      } as any;
      const localPositions = new Map<string, Position>();
      localPositions.set('BTCUSDT', createTestPosition('BTCUSDT'));

      const result = await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      // Should return empty results on error, not throw
      expect(result.synced).toEqual([]);
      expect(result.closed).toEqual([]);
      expect(result.imported).toEqual([]);
      // Local positions should remain unchanged
      expect(localPositions.size).toBe(1);
    });

    test('should handle malformed exchange position data', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT' }, // Missing required fields
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      // Should not throw, might import with defaults
      await expect(syncPositions(client, localPositions, 'test-agent', defaultConfig)).resolves.toBeDefined();
    });

    test('should handle very large position sizes', async () => {
      const exchangePositions = [
        {
          symbol: 'BTCUSDT',
          positionAmt: '100.0',
          entryPrice: '50000',
          leverage: '10',
          unrealizedProfit: '50000',
        },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.size).toBe(100);
      expect(imported.marginUsed).toBe(500000); // 100 * 50000 / 10
    });

    test('should handle fractional leverage values', async () => {
      const exchangePositions = [
        {
          symbol: 'BTCUSDT',
          positionAmt: '0.001',
          entryPrice: '50000',
          leverage: '7.5',
          unrealizedProfit: '5',
        },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.leverage).toBe(7.5);
      // Margin = 0.001 * 50000 / 7.5 = 6.67
      expect(imported.marginUsed).toBeCloseTo(6.67, 2);
    });

    test('should assign unique IDs to imported positions', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'test-agent', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.id).toMatch(/^imported-BTCUSDT-\d+$/);
    });
  });

  describe('Agent ID Handling', () => {
    test('should assign correct agent ID to imported positions', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();

      await syncPositions(client, localPositions, 'custom-agent-123', defaultConfig);

      const imported = localPositions.get('BTCUSDT')!;
      expect(imported.agentId).toBe('custom-agent-123');
    });

    test('should preserve agent ID in synced positions', async () => {
      const exchangePositions = [
        { symbol: 'BTCUSDT', positionAmt: '0.001', entryPrice: '50000', leverage: '10', unrealizedProfit: '5' },
      ];
      const client = createMockClient(exchangePositions);
      const localPositions = new Map<string, Position>();
      localPositions.set('BTCUSDT', createTestPosition('BTCUSDT', { agentId: 'original-agent' }));

      await syncPositions(client, localPositions, 'new-agent', defaultConfig);

      const synced = localPositions.get('BTCUSDT')!;
      expect(synced.agentId).toBe('original-agent'); // Should not change
    });
  });
});
