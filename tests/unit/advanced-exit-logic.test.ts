/**
 * Advanced Exit Logic Unit Tests
 * Tests for partial profit taking, profit lock, peak protection, and break-even exits
 */

import { updatePosition } from '../../src/services/position/position-manager';
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
  partialProfitEnabled: true,
  partialProfitROE: 1.0,
  partialProfitPercent: 50,
  dynamicTPEnabled: false,
};

function createTestPosition(overrides: Partial<Position> = {}): Position {
  const base: Position = {
    id: 'test-pos-1',
    agentId: 'test-agent',
    userId: 'test-user',
    symbol: 'BTCUSDT',
    side: 'long',
    size: 0.001,
    entryPrice: 50000,
    currentPrice: 50000,
    leverage: 10,
    marginUsed: 5, // 0.001 * 50000 / 10 = $5
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
    originalSize: 0.001,
    partialProfitTaken: false,
  };
  return { ...base, ...overrides };
}

// =============================================================================
// PARTIAL PROFIT TAKING TESTS
// =============================================================================

describe('Partial Profit Taking', () => {
  test('should trigger partial profit at configured ROE', () => {
    const config = { ...defaultConfig, partialProfitEnabled: true, partialProfitROE: 1.0, minProfitUSD: 0.01 };
    const position = createTestPosition({
      entryPrice: 50000,
      size: 0.01, // Larger size for more PnL
      originalSize: 0.01,
      marginUsed: 50, // 0.01 * 50000 / 10
      partialProfitTaken: false,
      breakEvenActivated: true, // Already activated, won't trigger again
      breakEvenStopPrice: 50010, // Set far enough away
    });

    // Price moves up 1% -> 1% * 10x leverage = 10% ROE... but that's too much
    // For 1% ROE at 10x leverage, we need 0.1% price move
    // 50000 * 1.001 = 50050, PnL = 50 * 0.01 = $0.50
    const currentPrice = 50050;

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('close_partial');
    expect(result.reason).toContain('Partial profit');
    expect(result.reason).toContain('1.00%');
  });

  test('should not trigger partial profit if already taken', () => {
    const config = { ...defaultConfig, partialProfitEnabled: true, partialProfitROE: 1.0 };
    const position = createTestPosition({
      entryPrice: 50000,
      originalSize: 0.001,
      partialProfitTaken: true, // Already taken
    });

    const currentPrice = 50050; // Would be 1% ROE

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).not.toBe('close_partial');
  });

  test('should not trigger partial profit when disabled', () => {
    const config = { ...defaultConfig, partialProfitEnabled: false, partialProfitROE: 1.0 };
    const position = createTestPosition({
      entryPrice: 50000,
      originalSize: 0.001,
      partialProfitTaken: false,
    });

    const currentPrice = 50050;

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).not.toBe('close_partial');
  });

  test('should not trigger partial profit if below minimum profit USD', () => {
    const config = {
      ...defaultConfig,
      partialProfitEnabled: true,
      partialProfitROE: 1.0,
      minProfitUSD: 10, // High minimum
    };
    const position = createTestPosition({
      entryPrice: 50000,
      size: 0.001, // Small position
      originalSize: 0.001,
      partialProfitTaken: false,
    });

    const currentPrice = 50050; // 1% ROE but only $0.50 profit

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).not.toBe('close_partial');
  });

  test('should not trigger partial profit if at full take profit', () => {
    const config = {
      ...defaultConfig,
      partialProfitEnabled: true,
      partialProfitROE: 1.0,
      takeProfitROE: 1.5,
      minProfitUSD: 0.01,
    };
    const position = createTestPosition({
      entryPrice: 50000,
      size: 0.01,
      originalSize: 0.01,
      marginUsed: 50,
      partialProfitTaken: false,
      breakEvenActivated: true,
      breakEvenStopPrice: 50010,
    });

    // At full TP ROE - PnL = 75 * 0.01 = $0.75
    const currentPrice = 50075; // 1.5% ROE

    const result = updatePosition(position, currentPrice, config);

    // Should hit full TP instead
    expect(result.action).toBe('close_tp');
  });

  test('should trigger between partial and full TP', () => {
    const config = {
      ...defaultConfig,
      partialProfitEnabled: true,
      partialProfitROE: 1.0,
      takeProfitROE: 1.5,
      minProfitUSD: 0.01,
    };
    const position = createTestPosition({
      entryPrice: 50000,
      size: 0.01,
      originalSize: 0.01,
      marginUsed: 50,
      partialProfitTaken: false,
      breakEvenActivated: true,
      breakEvenStopPrice: 50010,
    });

    // Between partial (1.0%) and full TP (1.5%) - PnL = 60 * 0.01 = $0.60
    const currentPrice = 50060; // ~1.2% ROE

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('close_partial');
  });

  test('should work for short positions', () => {
    const config = { ...defaultConfig, partialProfitEnabled: true, partialProfitROE: 1.0, minProfitUSD: 0.01 };
    const position = createTestPosition({
      side: 'short',
      entryPrice: 50000,
      size: 0.01,
      originalSize: 0.01,
      marginUsed: 50,
      partialProfitTaken: false,
      breakEvenActivated: true,
      breakEvenStopPrice: 49990,
    });

    // Price moves down 0.1% -> 1% ROE at 10x leverage - PnL = 50 * 0.01 = $0.50
    const currentPrice = 49950;

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('close_partial');
  });
});

// =============================================================================
// PROFIT LOCK STOP TESTS
// =============================================================================

describe('Profit Lock Stop', () => {
  test('should activate profit lock at 0.3% ROE', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      breakEvenActivated: false,
    });

    // 0.3% ROE at 10x = 0.03% price move
    const currentPrice = 50015; // ~0.3% ROE

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.position.breakEvenActivated).toBe(true);
    expect(result.position.breakEvenStopPrice).toBeDefined();
  });

  test('should calculate correct profit lock price for long position', () => {
    const position = createTestPosition({
      side: 'long',
      entryPrice: 50000,
      leverage: 10,
      breakEvenActivated: false,
    });

    const currentPrice = 50015; // Activate profit lock

    const result = updatePosition(position, currentPrice, defaultConfig);

    // Locked profit ROE is 0.2%
    // Price change = (0.2 / 10 / 100) * 50000 = $10
    // Stop price = 50000 + 10 = 50010
    expect(result.position.breakEvenStopPrice).toBeCloseTo(50010, 0);
  });

  test('should calculate correct profit lock price for short position', () => {
    const position = createTestPosition({
      side: 'short',
      entryPrice: 50000,
      leverage: 10,
      breakEvenActivated: false,
    });

    const currentPrice = 49985; // Activate profit lock

    const result = updatePosition(position, currentPrice, defaultConfig);

    // Locked profit ROE is 0.2%
    // Price change = (0.2 / 10 / 100) * 50000 = $10
    // Stop price = 50000 - 10 = 49990
    expect(result.position.breakEvenStopPrice).toBeCloseTo(49990, 0);
  });

  test('should trigger profit lock exit when hit (long)', () => {
    const position = createTestPosition({
      side: 'long',
      entryPrice: 50000,
      leverage: 10,
      breakEvenActivated: true,
      breakEvenStopPrice: 50010,
      highestROE: 0.5,
    });

    // Price drops to stop level
    const currentPrice = 50010;

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_trailing');
    expect(result.reason).toContain('Profit lock hit');
  });

  test('should trigger profit lock exit when hit (short)', () => {
    const position = createTestPosition({
      side: 'short',
      entryPrice: 50000,
      leverage: 10,
      breakEvenActivated: true,
      breakEvenStopPrice: 49990,
      highestROE: 0.5,
    });

    // Price rises to stop level
    const currentPrice = 49990;

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_trailing');
    expect(result.reason).toContain('Profit lock hit');
  });

  test('should not trigger profit lock if trailing stop is active', () => {
    const position = createTestPosition({
      side: 'long',
      entryPrice: 50000,
      breakEvenActivated: true,
      breakEvenStopPrice: 50010,
      trailingActivated: true, // Trailing takes priority
    });

    const currentPrice = 50010;

    const result = updatePosition(position, currentPrice, defaultConfig);

    // Should not use profit lock if trailing is active
    expect(result.reason).not.toContain('Profit lock');
  });
});

// =============================================================================
// PEAK PROTECTION TESTS
// =============================================================================

describe('Peak Protection', () => {
  test('should trigger when reversing 0.5% from peak above 1.0% ROE', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      highestROE: 1.2, // Hit 1.2% peak
      lowestROE: 0,
    });

    // Now at 0.6% ROE (reversed 0.6% from peak)
    const currentPrice = 50030; // 0.6% ROE

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_trailing');
    expect(result.reason).toContain('Peak protection');
    expect(result.reason).toContain('1.20%'); // Peak
  });

  test('should not trigger if reversal is less than 0.5% from high peak', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      highestROE: 1.2,
      lowestROE: 0,
    });

    // At 0.8% ROE (only 0.4% reversal)
    const currentPrice = 50040;

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).not.toBe('close_trailing');
  });

  test('should trigger when reversing 0.3% from small peak (0.3-1.0%)', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      highestROE: 0.8, // Small peak
      lowestROE: 0,
    });

    // Now at 0.4% ROE (reversed 0.4% from peak)
    const currentPrice = 50020;

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_trailing');
    expect(result.reason).toContain('Peak protection');
    expect(result.reason).toContain('0.80%'); // Peak
  });

  test('should not trigger for small peak with small reversal', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      highestROE: 0.8,
      lowestROE: 0,
    });

    // At 0.6% ROE (only 0.2% reversal)
    const currentPrice = 50030;

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).not.toBe('close_trailing');
  });

  test('should not trigger for very small peaks (<0.3%)', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      highestROE: 0.25, // Very small peak
      lowestROE: 0,
    });

    // Now at -0.1% ROE (reversed 0.35%)
    const currentPrice = 49995;

    const result = updatePosition(position, currentPrice, defaultConfig);

    // Should not use peak protection for such small peaks
    expect(result.reason).not.toContain('Peak protection');
  });

  test('should work for short positions', () => {
    const position = createTestPosition({
      side: 'short',
      entryPrice: 50000,
      highestROE: 1.5,
      lowestROE: 0,
    });

    // Now at 0.9% ROE (reversed 0.6% from 1.5%)
    const currentPrice = 49955;

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_trailing');
    expect(result.reason).toContain('Peak protection');
  });

  test('should track highest ROE correctly', () => {
    let position = createTestPosition({
      entryPrice: 50000,
      highestROE: 0,
    });

    // First update: 0.5% ROE
    let result = updatePosition(position, 50025, defaultConfig);
    expect(result.position.highestROE).toBeCloseTo(0.5, 1);

    // Second update: 1.0% ROE (new peak)
    result = updatePosition(result.position, 50050, defaultConfig);
    expect(result.position.highestROE).toBeCloseTo(1.0, 1);

    // Third update: 0.8% ROE (below peak)
    result = updatePosition(result.position, 50040, defaultConfig);
    expect(result.position.highestROE).toBeCloseTo(1.0, 1); // Peak unchanged
  });
});

// =============================================================================
// BREAK-EVEN STOP TESTS
// =============================================================================

describe('Break-Even Stop', () => {
  test('should activate break-even stop at 0.3% ROE', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      breakEvenActivated: false,
    });

    const currentPrice = 50015; // 0.3% ROE

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.position.breakEvenActivated).toBe(true);
    expect(result.position.breakEvenStopPrice).toBe(50000); // At entry
  });

  test('should not trigger exit if not near break-even', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      breakEvenActivated: true,
      breakEvenStopPrice: 50000,
    });

    const currentPrice = 50020; // Still in profit

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('hold');
  });

  test('should trigger exit when returning to break-even', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      breakEvenActivated: true,
      breakEvenStopPrice: 50000,
    });

    const currentPrice = 50002; // Very close to break-even, ROE < 0.1%

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_trailing');
    expect(result.reason).toContain('Break-even exit');
  });

  test('should not trigger if ROE is above 0.1%', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      breakEvenActivated: true,
      breakEvenStopPrice: 50000,
    });

    const currentPrice = 50010; // ROE > 0.1%

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).not.toBe('close_trailing');
  });
});

// =============================================================================
// TIME-BASED EXIT TESTS
// =============================================================================

describe('Time-Based Exit', () => {
  test('should trigger time exit for unprofitable position after 5 minutes', () => {
    const openedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    const position = createTestPosition({
      entryPrice: 50000,
      openedAt,
    });

    const currentPrice = 50005; // Only 0.1% ROE

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_time');
    expect(result.reason).toContain('Time exit');
    expect(result.reason).toContain('6.0min');
  });

  test('should not trigger time exit if position is profitable', () => {
    const openedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    const position = createTestPosition({
      entryPrice: 50000,
      openedAt,
    });

    const currentPrice = 50020; // 0.4% ROE, profitable

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).not.toBe('close_time');
  });

  test('should not trigger time exit before 5 minutes', () => {
    const openedAt = Date.now() - 3 * 60 * 1000; // 3 minutes ago
    const position = createTestPosition({
      entryPrice: 50000,
      openedAt,
    });

    const currentPrice = 50005; // Unprofitable

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('hold');
  });

  test('should trigger max hold time regardless of profitability', () => {
    const config = { ...defaultConfig, maxHoldTimeMinutes: 5 };
    const openedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago (past max)
    const position = createTestPosition({
      entryPrice: 50000,
      openedAt,
    });

    const currentPrice = 50030; // Profitable

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('close_time');
    expect(result.reason).toContain('Max hold time');
  });

  test('should trigger exactly at max hold time', () => {
    const config = { ...defaultConfig, maxHoldTimeMinutes: 5 };
    const openedAt = Date.now() - 5 * 60 * 1000; // Exactly 5 minutes ago
    const position = createTestPosition({
      entryPrice: 50000,
      openedAt,
    });

    const currentPrice = 50030;

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('close_time');
  });
});

// =============================================================================
// EXIT PRIORITY TESTS
// =============================================================================

describe('Exit Condition Priority', () => {
  test('should prioritize stop loss over all other exits', () => {
    const openedAt = Date.now() - 10 * 60 * 1000; // Old position
    const position = createTestPosition({
      entryPrice: 50000,
      openedAt,
      highestROE: 1.0,
      breakEvenActivated: true,
    });

    // Price way down (stop loss triggered)
    const currentPrice = 49800;

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_sl');
    expect(result.reason).toContain('stop loss');
  });

  test('should prioritize take profit over time/trailing', () => {
    const openedAt = Date.now() - 10 * 60 * 1000;
    const position = createTestPosition({
      entryPrice: 50000,
      openedAt,
      trailingActivated: true,
    });

    // At take profit level
    const currentPrice = 50075; // 1.5% ROE

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_tp');
  });

  test('should check partial profit before full TP', () => {
    const config = {
      ...defaultConfig,
      partialProfitEnabled: true,
      partialProfitROE: 1.0,
      takeProfitROE: 1.5,
    };
    const position = createTestPosition({
      entryPrice: 50000,
      originalSize: 0.001,
      partialProfitTaken: false,
    });

    // Between partial and full TP
    const currentPrice = 50055; // ~1.1% ROE

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('close_partial');
  });

  test('should check trailing stop after profit lock', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      breakEvenActivated: true,
      breakEvenStopPrice: 50010,
      trailingActivated: true, // Both active
      trailingStopPrice: 50030,
    });

    // Price at trailing stop level
    const currentPrice = 50030;

    const result = updatePosition(position, currentPrice, defaultConfig);

    // Trailing takes priority when both active
    expect(result.action).toBe('close_trailing');
    expect(result.reason).not.toContain('Profit lock');
  });
});

// =============================================================================
// DYNAMIC TAKE PROFIT TESTS
// =============================================================================

describe('Dynamic Take Profit', () => {
  test('should use dynamic TP when available', () => {
    const config = { ...defaultConfig, takeProfitROE: 1.5 };
    const position = createTestPosition({
      entryPrice: 50000,
      dynamicTP: 2.0, // Higher than standard
    });

    // At standard TP but below dynamic TP
    const currentPrice = 50075; // 1.5% ROE

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('hold'); // Not at dynamic TP yet
  });

  test('should trigger when dynamic TP is reached', () => {
    const config = { ...defaultConfig, takeProfitROE: 1.5 };
    const position = createTestPosition({
      entryPrice: 50000,
      dynamicTP: 2.0,
    });

    // At dynamic TP
    const currentPrice = 50100; // 2.0% ROE

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('close_tp');
    expect(result.reason).toContain('2.0%'); // Dynamic TP
  });

  test('should fall back to standard TP when no dynamic TP', () => {
    const position = createTestPosition({
      entryPrice: 50000,
      dynamicTP: undefined,
    });

    // At standard TP
    const currentPrice = 50075; // 1.5% ROE

    const result = updatePosition(position, currentPrice, defaultConfig);

    expect(result.action).toBe('close_tp');
  });

  test('should use position-level TP over config TP', () => {
    const config = { ...defaultConfig, takeProfitROE: 1.5 };
    const position = createTestPosition({
      entryPrice: 50000,
      takeProfit: 2.5, // Position-specific TP
    });

    // At config TP but below position TP
    const currentPrice = 50075; // 1.5% ROE

    const result = updatePosition(position, currentPrice, config);

    expect(result.action).toBe('hold'); // Not at 2.5% yet
  });
});
