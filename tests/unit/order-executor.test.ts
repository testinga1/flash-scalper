/**
 * Order Executor Unit Tests
 * Tests for risk management functions in the order executor
 */

import {
  calculatePositionSize,
  calculateExposure,
  canOpenPosition,
} from '../../src/services/execution/order-executor';
import type { Position, ScalperConfig } from '../../src/types';

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
  dynamicPositionSizing: true,
  maxPositionSizeBoost: 1.5,
  minPositionSizeReduction: 0.7,
  performanceAdaptation: true,
  highWinRateThreshold: 0.65,
};

function createTestPosition(
  symbol: string,
  marginUsed: number,
  overrides: Partial<Position> = {}
): Position {
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
    marginUsed,
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

// =============================================================================
// CALCULATE POSITION SIZE TESTS
// =============================================================================

describe('calculatePositionSize', () => {
  describe('Fixed Position Size', () => {
    test('should use fixed position size when configured', () => {
      const config = { ...defaultConfig, positionSizeUSD: 50 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;

      const quantity = calculatePositionSize(equity, currentExposure, price, config);

      // $50 / $50000 = 0.001 BTC
      expect(quantity).toBeCloseTo(0.001, 8);
    });

    test('should apply min constraint to fixed size', () => {
      const config = { ...defaultConfig, positionSizeUSD: 5, minPositionSizeUSD: 10 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;

      const quantity = calculatePositionSize(equity, currentExposure, price, config);

      // Should use minPositionSizeUSD of $10
      expect(quantity).toBeCloseTo(0.0002, 8);
    });

    test('should apply max constraint to fixed size', () => {
      const config = { ...defaultConfig, positionSizeUSD: 200, maxPositionSizeUSD: 150 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;

      const quantity = calculatePositionSize(equity, currentExposure, price, config);

      // Should use maxPositionSizeUSD of $150
      expect(quantity).toBeCloseTo(0.003, 8);
    });
  });

  describe('Percentage-Based Position Size', () => {
    test('should calculate position size based on percentage of available balance', () => {
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;

      const quantity = calculatePositionSize(equity, currentExposure, price, defaultConfig);

      // Available: $1000, 35% = $350, but capped at maxPositionSizeUSD $150
      // $150 / $50000 = 0.003
      expect(quantity).toBeCloseTo(0.003, 8);
    });

    test('should subtract current exposure from available balance', () => {
      const equity = 1000;
      const currentExposure = 600; // $600 already in positions
      const price = 50000;

      const quantity = calculatePositionSize(equity, currentExposure, price, defaultConfig);

      // Available: $1000 - $600 = $400, 35% = $140
      expect(quantity).toBeCloseTo(0.0028, 8);
    });

    test('should handle zero available balance', () => {
      const equity = 500;
      const currentExposure = 500;
      const price = 50000;

      const quantity = calculatePositionSize(equity, currentExposure, price, defaultConfig);

      // Available: $0, but should use minPositionSizeUSD
      expect(quantity).toBeCloseTo(0.0002, 8); // $10 min / $50000
    });

    test('should apply min and max constraints', () => {
      const config = { ...defaultConfig, minPositionSizeUSD: 50, maxPositionSizeUSD: 100 };

      // Test min constraint
      const equity1 = 100;
      const qty1 = calculatePositionSize(equity1, 0, 50000, config);
      expect(qty1).toBeCloseTo(0.001, 8); // $50 min / $50000

      // Test max constraint
      const equity2 = 10000;
      const qty2 = calculatePositionSize(equity2, 0, 50000, config);
      expect(qty2).toBeCloseTo(0.002, 8); // $100 max / $50000
    });
  });

  describe('Dynamic Position Sizing', () => {
    test('should increase size for high confidence signals (70%+)', () => {
      // Use low equity so we don't hit max constraint
      const config = { ...defaultConfig, maxPositionSizeUSD: 1000 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const highConfidence = 75;

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        config,
        highConfidence
      );

      // Should boost position size
      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...config,
        dynamicPositionSizing: false,
      });
      expect(quantity).toBeGreaterThan(baseQuantity);
    });

    test('should decrease size for low confidence signals (<65%)', () => {
      const config = { ...defaultConfig, maxPositionSizeUSD: 1000 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const lowConfidence = 58;

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        config,
        lowConfidence
      );

      // Should reduce position size
      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...config,
        dynamicPositionSizing: false,
      });
      expect(quantity).toBeLessThan(baseQuantity);
    });

    test('should not exceed max boost multiplier', () => {
      const config = { ...defaultConfig, maxPositionSizeBoost: 1.5 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const veryHighConfidence = 95;

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        config,
        veryHighConfidence
      );

      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...config,
        dynamicPositionSizing: false,
      });

      // Should not exceed 1.5x boost (accounting for max constraint)
      const ratio = quantity / baseQuantity;
      expect(ratio).toBeLessThanOrEqual(1.51); // Small margin for floating point
    });

    test('should apply reduction multiplier for low confidence', () => {
      const config = { ...defaultConfig, minPositionSizeReduction: 0.7, maxPositionSizeUSD: 1000 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const lowConfidence = 55;

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        config,
        lowConfidence
      );

      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...config,
        dynamicPositionSizing: false,
      });

      // Should reduce to ~0.7x
      expect(quantity).toBeLessThan(baseQuantity);
    });
  });

  describe('Performance-Based Adaptation', () => {
    test('should increase size for high win rate (>=65%)', () => {
      const config = { ...defaultConfig, maxPositionSizeUSD: 1000 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const highWinRate = 0.7; // 70% win rate

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        config,
        undefined,
        highWinRate
      );

      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...config,
        performanceAdaptation: false,
      });

      // Should increase by 15%
      expect(quantity).toBeGreaterThan(baseQuantity);
    });

    test('should decrease size for low win rate (<40%)', () => {
      const config = { ...defaultConfig, maxPositionSizeUSD: 1000 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const lowWinRate = 0.35; // 35% win rate

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        config,
        undefined,
        lowWinRate
      );

      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...config,
        performanceAdaptation: false,
      });

      // Should decrease by 20%
      expect(quantity).toBeLessThan(baseQuantity);
    });

    test('should not adjust for medium win rate (40-65%)', () => {
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const mediumWinRate = 0.55; // 55% win rate

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        defaultConfig,
        undefined,
        mediumWinRate
      );

      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...defaultConfig,
        performanceAdaptation: false,
      });

      // Should be approximately equal
      expect(quantity).toBeCloseTo(baseQuantity, 6);
    });
  });

  describe('Combined Dynamic and Performance Sizing', () => {
    test('should combine confidence boost and win rate increase', () => {
      const config = { ...defaultConfig, maxPositionSizeUSD: 1000 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const highConfidence = 80;
      const highWinRate = 0.7;

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        config,
        highConfidence,
        highWinRate
      );

      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...config,
        dynamicPositionSizing: false,
        performanceAdaptation: false,
      });

      // Should be significantly larger
      expect(quantity).toBeGreaterThan(baseQuantity);
    });

    test('should combine confidence reduction and win rate decrease', () => {
      const config = { ...defaultConfig, maxPositionSizeUSD: 1000 };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;
      const lowConfidence = 55;
      const lowWinRate = 0.35;

      const quantity = calculatePositionSize(
        equity,
        currentExposure,
        price,
        config,
        lowConfidence,
        lowWinRate
      );

      const baseQuantity = calculatePositionSize(equity, currentExposure, price, {
        ...config,
        dynamicPositionSizing: false,
        performanceAdaptation: false,
      });

      // Should be significantly smaller
      expect(quantity).toBeLessThan(baseQuantity);
    });
  });

  describe('Edge Cases', () => {
    test('should handle very high price assets', () => {
      const equity = 1000;
      const currentExposure = 0;
      const price = 100000; // $100k BTC

      const quantity = calculatePositionSize(equity, currentExposure, price, defaultConfig);

      // Should still calculate correctly
      expect(quantity).toBeGreaterThan(0);
      expect(quantity * price).toBeGreaterThanOrEqual(defaultConfig.minPositionSizeUSD);
    });

    test('should handle very low price assets', () => {
      const equity = 1000;
      const currentExposure = 0;
      const price = 0.5; // $0.50 altcoin

      const quantity = calculatePositionSize(equity, currentExposure, price, defaultConfig);

      // Should still calculate correctly
      expect(quantity).toBeGreaterThan(0);
      expect(quantity * price).toBeGreaterThanOrEqual(defaultConfig.minPositionSizeUSD);
    });

    test('should handle disabled dynamic sizing', () => {
      const config = { ...defaultConfig, dynamicPositionSizing: false };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;

      const qty1 = calculatePositionSize(equity, currentExposure, price, config, 80);
      const qty2 = calculatePositionSize(equity, currentExposure, price, config, 55);

      // Should be the same regardless of confidence
      expect(qty1).toBeCloseTo(qty2, 8);
    });

    test('should handle disabled performance adaptation', () => {
      const config = { ...defaultConfig, performanceAdaptation: false };
      const equity = 1000;
      const currentExposure = 0;
      const price = 50000;

      const qty1 = calculatePositionSize(equity, currentExposure, price, config, undefined, 0.7);
      const qty2 = calculatePositionSize(equity, currentExposure, price, config, undefined, 0.35);

      // Should be the same regardless of win rate
      expect(qty1).toBeCloseTo(qty2, 8);
    });
  });
});

// =============================================================================
// CALCULATE EXPOSURE TESTS
// =============================================================================

describe('calculateExposure', () => {
  test('should return 0 for no positions', () => {
    const positions = new Map<string, Position>();
    const exposure = calculateExposure(positions);
    expect(exposure).toBe(0);
  });

  test('should sum margin from single position', () => {
    const positions = new Map<string, Position>();
    positions.set('pos1', createTestPosition('BTCUSDT', 50));

    const exposure = calculateExposure(positions);
    expect(exposure).toBe(50);
  });

  test('should sum margin from multiple positions', () => {
    const positions = new Map<string, Position>();
    positions.set('pos1', createTestPosition('BTCUSDT', 50));
    positions.set('pos2', createTestPosition('ETHUSDT', 30));
    positions.set('pos3', createTestPosition('BNBUSDT', 20));

    const exposure = calculateExposure(positions);
    expect(exposure).toBe(100);
  });

  test('should handle positions with zero margin', () => {
    const positions = new Map<string, Position>();
    positions.set('pos1', createTestPosition('BTCUSDT', 0));
    positions.set('pos2', createTestPosition('ETHUSDT', 50));

    const exposure = calculateExposure(positions);
    expect(exposure).toBe(50);
  });

  test('should handle large number of positions', () => {
    const positions = new Map<string, Position>();
    for (let i = 0; i < 100; i++) {
      positions.set(`pos${i}`, createTestPosition(`SYM${i}`, 10));
    }

    const exposure = calculateExposure(positions);
    expect(exposure).toBe(1000);
  });

  test('should handle fractional margin values', () => {
    const positions = new Map<string, Position>();
    positions.set('pos1', createTestPosition('BTCUSDT', 15.75));
    positions.set('pos2', createTestPosition('ETHUSDT', 23.33));

    const exposure = calculateExposure(positions);
    expect(exposure).toBeCloseTo(39.08, 2);
  });
});

// =============================================================================
// CAN OPEN POSITION TESTS
// =============================================================================

describe('canOpenPosition', () => {
  describe('Equity Checks', () => {
    test('should allow opening with sufficient equity', () => {
      const equity = 100;
      const currentExposure = 0;
      const positionCount = 0;
      const estimatedMargin = 10;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    test('should reject when equity below minimum ($10)', () => {
      const equity = 9;
      const currentExposure = 0;
      const positionCount = 0;
      const estimatedMargin = 5;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient equity');
      expect(result.reason).toContain('$9.00 < $10');
    });

    test('should allow exactly $10 equity', () => {
      const config = { ...defaultConfig, maxExposurePercent: 100 }; // Allow full equity use
      const equity = 10;
      const currentExposure = 0;
      const positionCount = 0;
      const estimatedMargin = 8; // 80% of $10

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, config);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Position Count Checks', () => {
    test('should allow opening when under max positions', () => {
      const config = { ...defaultConfig, maxPositions: 5 };
      const equity = 1000;
      const currentExposure = 100;
      const positionCount = 4;
      const estimatedMargin = 50;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, config);

      expect(result.allowed).toBe(true);
    });

    test('should reject when at max positions', () => {
      const config = { ...defaultConfig, maxPositions: 5 };
      const equity = 1000;
      const currentExposure = 100;
      const positionCount = 5;
      const estimatedMargin = 50;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max positions reached');
      expect(result.reason).toContain('5/5');
    });

    test('should allow opening with 0 current positions', () => {
      const equity = 1000;
      const currentExposure = 0;
      const positionCount = 0;
      const estimatedMargin = 50;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
    });
  });

  describe('Exposure Limit Checks', () => {
    test('should allow opening when under max exposure', () => {
      const equity = 1000;
      const currentExposure = 400; // 40% of equity
      const positionCount = 2;
      const estimatedMargin = 200; // Total would be 60%

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
    });

    test('should reject when new position would exceed max exposure', () => {
      const equity = 1000;
      const currentExposure = 600; // 60% of equity
      const positionCount = 3;
      const estimatedMargin = 300; // Total would be 90%, exceeds 80%

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Exposure limit');
      expect(result.reason).toContain('$900.00 > $800.00');
    });

    test('should allow opening exactly at max exposure', () => {
      const equity = 1000;
      const currentExposure = 400;
      const positionCount = 2;
      const estimatedMargin = 400; // Exactly 80%

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
    });

    test('should calculate max exposure correctly with different percentages', () => {
      const config = { ...defaultConfig, maxExposurePercent: 50 };
      const equity = 1000;
      const currentExposure = 300;
      const positionCount = 2;
      const estimatedMargin = 250; // Total 55%, exceeds 50%

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('$550.00 > $500.00');
    });

    test('should reject when max exposure is too low', () => {
      const config = { ...defaultConfig, maxExposurePercent: 50 };
      const equity = 15; // Max exposure = $7.50, below $10 minimum
      const currentExposure = 0;
      const positionCount = 0;
      const estimatedMargin = 5;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max exposure too low');
      expect(result.reason).toContain('$7.50 < $10');
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero current exposure', () => {
      const equity = 1000;
      const currentExposure = 0;
      const positionCount = 0;
      const estimatedMargin = 100;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
    });

    test('should handle zero estimated margin', () => {
      const equity = 1000;
      const currentExposure = 500;
      const positionCount = 2;
      const estimatedMargin = 0;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
    });

    test('should handle very high equity', () => {
      const equity = 1000000;
      const currentExposure = 500000;
      const positionCount = 10;
      const estimatedMargin = 100000;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
    });

    test('should handle fractional equity and margins', () => {
      const equity = 125.75;
      const currentExposure = 50.25;
      const positionCount = 2;
      const estimatedMargin = 30.10;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
    });

    test('should reject when multiple conditions fail', () => {
      const config = { ...defaultConfig, maxPositions: 5 };
      const equity = 100;
      const currentExposure = 70;
      const positionCount = 5; // At max positions
      const estimatedMargin = 50; // Would exceed exposure

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, config);

      expect(result.allowed).toBe(false);
      // Should return first failure (max positions)
      expect(result.reason).toContain('Max positions reached');
    });

    test('should provide detailed error messages', () => {
      const equity = 1000;
      const currentExposure = 600;
      const positionCount = 5;
      const estimatedMargin = 300;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('Current: $600.00');
      expect(result.reason).toContain('New: $300.00');
      expect(result.reason).toContain('Max: $800.00');
    });
  });

  describe('Boundary Conditions', () => {
    test('should handle equity exactly at minimum with valid margin', () => {
      const config = { ...defaultConfig, maxExposurePercent: 100 }; // Allow full equity use
      const equity = 10;
      const currentExposure = 0;
      const positionCount = 0;
      const estimatedMargin = 8; // 80% of $10

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, config);

      expect(result.allowed).toBe(true);
    });

    test('should reject when position count is one over limit', () => {
      const config = { ...defaultConfig, maxPositions: 10 };
      const equity = 10000;
      const currentExposure = 1000;
      const positionCount = 10;
      const estimatedMargin = 100;

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('10/10');
    });

    test('should allow when exposure is just under limit', () => {
      const equity = 1000;
      const currentExposure = 700;
      const positionCount = 5;
      const estimatedMargin = 99; // Total: $799, just under $800 limit

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(true);
    });

    test('should reject when exposure is just over limit', () => {
      const equity = 1000;
      const currentExposure = 700;
      const positionCount = 5;
      const estimatedMargin = 101; // Total: $801, just over $800 limit

      const result = canOpenPosition(equity, currentExposure, positionCount, estimatedMargin, defaultConfig);

      expect(result.allowed).toBe(false);
    });
  });
});
