/**
 * Multi-Exchange Position Manager Unit Tests
 * Tests for risk management functions across multiple exchanges
 */

import {
  MultiExchangePositionManager,
  UnifiedPosition,
} from '../../src/services/position/multi-exchange-position-manager';
import type { ScalperConfig } from '../../src/types';
import { ExchangeType } from '../../src/services/execution/exchange-abstraction';

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

function createMockPosition(overrides: Partial<UnifiedPosition> = {}): UnifiedPosition {
  return {
    id: 'test-pos-1',
    exchange: 'aster',
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
    openedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// =============================================================================
// MONITOR POSITION TESTS
// =============================================================================

describe('MultiExchangePositionManager.monitorPosition', () => {
  let manager: MultiExchangePositionManager;

  beforeEach(() => {
    manager = new MultiExchangePositionManager();
  });

  describe('Stop Loss Checks', () => {
    test('should trigger close when stop loss is hit', async () => {
      const position = createMockPosition({
        unrealizedROE: -0.5, // Below -0.4% stop loss
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.shouldClose).toBe(true);
      expect(result.reason).toContain('Stop-loss hit');
      expect(result.reason).toContain('-0.50%');
    });

    test('should not trigger close when above stop loss', async () => {
      const position = createMockPosition({
        unrealizedROE: -0.3, // Above -0.4% stop loss
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).not.toBe('close');
      expect(result.shouldClose).not.toBe(true);
    });

    test('should trigger exactly at stop loss threshold', async () => {
      const position = createMockPosition({
        unrealizedROE: -0.4, // Exactly at stop loss
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.shouldClose).toBe(true);
    });

    test('should handle different stop loss configurations', async () => {
      const config = { ...defaultConfig, stopLossROE: -1.0 };
      const position = createMockPosition({
        unrealizedROE: -0.5,
      });

      const result = await manager.monitorPosition(position, config);

      expect(result.action).not.toBe('close');
      expect(result.shouldClose).not.toBe(true);
    });
  });

  describe('Take Profit Checks', () => {
    test('should trigger close when take profit is hit', async () => {
      const position = createMockPosition({
        unrealizedROE: 1.6, // Above 1.5% take profit
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.shouldClose).toBe(true);
      expect(result.reason).toContain('Take-profit hit');
      expect(result.reason).toContain('1.60%');
    });

    test('should not trigger close when below take profit', async () => {
      const position = createMockPosition({
        unrealizedROE: 1.0, // Below 1.5% take profit
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).not.toBe('close');
      expect(result.shouldClose).not.toBe(true);
    });

    test('should use custom take profit from position', async () => {
      const position = createMockPosition({
        unrealizedROE: 2.0,
        takeProfit: 2.5, // Custom TP
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).not.toBe('close');
      expect(result.shouldClose).not.toBe(true);
    });

    test('should trigger with custom take profit', async () => {
      const position = createMockPosition({
        unrealizedROE: 3.0,
        takeProfit: 2.5,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.shouldClose).toBe(true);
    });
  });

  describe('Max Hold Time Checks', () => {
    test('should trigger close when max hold time exceeded', async () => {
      const openedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      const position = createMockPosition({
        unrealizedROE: 0.5,
        openedAt,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.shouldClose).toBe(true);
      expect(result.reason).toContain('Max hold time exceeded');
      expect(result.reason).toContain('6.0 minutes');
    });

    test('should not trigger close when under max hold time', async () => {
      const openedAt = Date.now() - 3 * 60 * 1000; // 3 minutes ago
      const position = createMockPosition({
        unrealizedROE: 0.5,
        openedAt,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).not.toBe('close');
      expect(result.shouldClose).not.toBe(true);
    });

    test('should trigger exactly at max hold time', async () => {
      const openedAt = Date.now() - 5 * 60 * 1000; // Exactly 5 minutes ago
      const position = createMockPosition({
        unrealizedROE: 0.5,
        openedAt,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.shouldClose).toBe(true);
    });

    test('should handle different max hold time configurations', async () => {
      const config = { ...defaultConfig, maxHoldTimeMinutes: 10 };
      const openedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      const position = createMockPosition({
        unrealizedROE: 0.5,
        openedAt,
      });

      const result = await manager.monitorPosition(position, config);

      expect(result.action).not.toBe('close');
      expect(result.shouldClose).not.toBe(true);
    });
  });

  describe('Trailing Stop Checks', () => {
    test('should activate trailing stop when ROE exceeds activation threshold', async () => {
      const position = createMockPosition({
        unrealizedROE: 0.6, // Above 0.5% activation
        currentPrice: 50500,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('update_trailing');
      expect(result.reason).toContain('Trailing stop activated');
      expect(result.reason).toContain('0.60%');
      expect(result.newStopLoss).toBeDefined();
    });

    test('should not activate trailing stop when below activation threshold', async () => {
      const position = createMockPosition({
        unrealizedROE: 0.4, // Below 0.5% activation
        currentPrice: 50200,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('hold');
      expect(result.newStopLoss).toBeUndefined();
    });

    test('should calculate trailing stop price correctly', async () => {
      const currentPrice = 50000;
      const position = createMockPosition({
        unrealizedROE: 0.6,
        currentPrice,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      // Trailing distance is 0.2%, so stop should be 0.2% below current price
      const expectedStop = currentPrice * (1 - 0.2 / 100);
      expect(result.newStopLoss).toBeCloseTo(expectedStop, 2);
    });

    test('should use custom trailing distance if configured', async () => {
      const config = { ...defaultConfig, trailingDistanceROE: 0.5 };
      const currentPrice = 50000;
      const position = createMockPosition({
        unrealizedROE: 0.6,
        currentPrice,
      });

      const result = await manager.monitorPosition(position, config);

      // Trailing distance is 0.5%
      const expectedStop = currentPrice * (1 - 0.5 / 100);
      expect(result.newStopLoss).toBeCloseTo(expectedStop, 2);
    });
  });

  describe('Multiple Conditions Priority', () => {
    test('should prioritize stop loss over take profit', async () => {
      const position = createMockPosition({
        unrealizedROE: -0.5, // Both SL and should not be TP
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.reason).toContain('Stop-loss');
    });

    test('should check stop loss before max hold time', async () => {
      const openedAt = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const position = createMockPosition({
        unrealizedROE: -0.5, // Stop loss triggered
        openedAt,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.reason).toContain('Stop-loss');
    });

    test('should check take profit before max hold time', async () => {
      const openedAt = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const position = createMockPosition({
        unrealizedROE: 2.0, // Take profit triggered
        openedAt,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.reason).toContain('Take-profit');
    });

    test('should check trailing stop after other exit conditions', async () => {
      const position = createMockPosition({
        unrealizedROE: 0.6, // Trailing stop activation
        currentPrice: 50500,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('update_trailing');
    });
  });

  describe('Hold Conditions', () => {
    test('should return hold when no exit conditions are met', async () => {
      const position = createMockPosition({
        unrealizedROE: 0.3, // Within acceptable range
        openedAt: Date.now() - 2 * 60 * 1000, // 2 minutes
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('hold');
      expect(result.shouldClose).toBeUndefined();
      expect(result.reason).toContain('acceptable parameters');
    });

    test('should hold when ROE is near zero', async () => {
      const position = createMockPosition({
        unrealizedROE: 0.0,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('hold');
    });

    test('should hold when in small profit', async () => {
      const position = createMockPosition({
        unrealizedROE: 0.2,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('hold');
    });

    test('should hold when in small loss', async () => {
      const position = createMockPosition({
        unrealizedROE: -0.1,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('hold');
    });
  });

  describe('Edge Cases', () => {
    test('should handle position with zero ROE', async () => {
      const position = createMockPosition({
        unrealizedROE: 0,
        unrealizedPnl: 0,
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('hold');
    });

    test('should handle position opened just now', async () => {
      const position = createMockPosition({
        unrealizedROE: 0.3,
        openedAt: Date.now(),
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('hold');
    });

    test('should handle very high ROE', async () => {
      const position = createMockPosition({
        unrealizedROE: 10.0, // 10% ROE
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.reason).toContain('Take-profit');
    });

    test('should handle very low ROE', async () => {
      const position = createMockPosition({
        unrealizedROE: -5.0, // -5% ROE
      });

      const result = await manager.monitorPosition(position, defaultConfig);

      expect(result.action).toBe('close');
      expect(result.reason).toContain('Stop-loss');
    });
  });
});

// =============================================================================
// POSITION CONVERSION TESTS
// =============================================================================

describe('MultiExchangePositionManager Position Conversion', () => {
  let manager: MultiExchangePositionManager;

  beforeEach(() => {
    manager = new MultiExchangePositionManager();
  });

  test('should convert position with standard format', () => {
    const rawPosition = {
      symbol: 'BTCUSDT',
      size: '0.001',
      entry_price: '50000',
      mark_price: '51000',
      unrealized_pnl: '1',
      side: 'long',
      margin: '5',
      leverage: '10',
    };

    // Access private method via any cast for testing
    const unified = (manager as any).convertToUnifiedPosition(rawPosition, 'aster');

    expect(unified).toBeDefined();
    expect(unified.symbol).toBe('BTCUSDT');
    expect(unified.side).toBe('long');
    expect(unified.size).toBe(0.001);
    expect(unified.entryPrice).toBe(50000);
    expect(unified.currentPrice).toBe(51000);
    expect(unified.unrealizedPnl).toBe(1);
    expect(unified.marginUsed).toBe(5);
    expect(unified.leverage).toBe(10);
  });

  test('should convert position with alternative field names', () => {
    const rawPosition = {
      market: 'ETHUSDT',
      positionAmt: '0.5',
      entryPrice: '2000',
      currentPrice: '2100',
      unrealizedProfit: '50',
      marginUsed: '100',
      leverage: '20',
    };

    const unified = (manager as any).convertToUnifiedPosition(rawPosition, 'paradex');

    expect(unified).toBeDefined();
    expect(unified.symbol).toBe('ETHUSDT');
    expect(unified.size).toBe(0.5);
    expect(unified.entryPrice).toBe(2000);
    expect(unified.currentPrice).toBe(2100);
  });

  test('should calculate ROE correctly', () => {
    const rawPosition = {
      symbol: 'BTCUSDT',
      size: '0.001',
      entry_price: '50000',
      mark_price: '51000',
      unrealized_pnl: '1',
      side: 'long',
      margin: '5',
      leverage: '10',
    };

    const unified = (manager as any).convertToUnifiedPosition(rawPosition, 'aster');

    // ROE = (unrealizedPnl / margin) * 100 = (1 / 5) * 100 = 20%
    expect(unified.unrealizedROE).toBeCloseTo(20, 2);
  });

  test('should determine side from positionAmt', () => {
    const longPosition = {
      symbol: 'BTCUSDT',
      positionAmt: '0.5',
      entry_price: '50000',
      mark_price: '51000',
      unrealized_pnl: '500',
      margin: '2500',
      leverage: '10',
    };

    const shortPosition = {
      symbol: 'BTCUSDT',
      positionAmt: '-0.5',
      entry_price: '50000',
      mark_price: '49000',
      unrealized_pnl: '500',
      margin: '2500',
      leverage: '10',
    };

    const long = (manager as any).convertToUnifiedPosition(longPosition, 'binance');
    const short = (manager as any).convertToUnifiedPosition(shortPosition, 'binance');

    expect(long.side).toBe('long');
    expect(short.side).toBe('short');
  });

  test('should return null for zero size positions', () => {
    const rawPosition = {
      symbol: 'BTCUSDT',
      size: '0',
      entry_price: '50000',
      mark_price: '50000',
      unrealized_pnl: '0',
      side: 'long',
      margin: '0',
      leverage: '10',
    };

    const unified = (manager as any).convertToUnifiedPosition(rawPosition, 'aster');

    expect(unified).toBeNull();
  });

  test('should handle missing optional fields', () => {
    const rawPosition = {
      symbol: 'BTCUSDT',
      size: '0.001',
      entry_price: '50000',
      mark_price: '51000',
      unrealized_pnl: '1',
      side: 'long',
      margin: '5',
    };

    const unified = (manager as any).convertToUnifiedPosition(rawPosition, 'aster');

    expect(unified).toBeDefined();
    expect(unified.leverage).toBe(1); // Default leverage
  });

  test('should handle liquidation price if present', () => {
    const rawPosition = {
      symbol: 'BTCUSDT',
      size: '0.001',
      entry_price: '50000',
      mark_price: '51000',
      unrealized_pnl: '1',
      side: 'long',
      margin: '5',
      leverage: '10',
      liquidation_price: '45000',
    };

    const unified = (manager as any).convertToUnifiedPosition(rawPosition, 'aster');

    expect(unified.liquidationPrice).toBe(45000);
  });
});

// =============================================================================
// EXPOSURE CALCULATION TESTS
// =============================================================================

describe('MultiExchangePositionManager.canOpenNewPosition', () => {
  let manager: MultiExchangePositionManager;

  beforeEach(() => {
    manager = new MultiExchangePositionManager();

    // Mock the getAllUnifiedPositions method
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should allow opening when under position limit', async () => {
    const positions: UnifiedPosition[] = [
      createMockPosition({ id: 'pos1' }),
      createMockPosition({ id: 'pos2' }),
    ];
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue(positions);

    const result = await manager.canOpenNewPosition(defaultConfig, 100);

    expect(result.canOpen).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('should reject when at max positions', async () => {
    const config = { ...defaultConfig, maxPositions: 2 };
    const positions: UnifiedPosition[] = [
      createMockPosition({ id: 'pos1' }),
      createMockPosition({ id: 'pos2' }),
    ];
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue(positions);

    const result = await manager.canOpenNewPosition(config, 100);

    expect(result.canOpen).toBe(false);
    expect(result.reason).toContain('Maximum positions reached');
    expect(result.reason).toContain('2/2');
  });

  test('should allow opening with zero current positions', async () => {
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue([]);

    const result = await manager.canOpenNewPosition(defaultConfig, 100);

    expect(result.canOpen).toBe(true);
  });
});

// =============================================================================
// POSITION SUMMARY TESTS
// =============================================================================

describe('MultiExchangePositionManager.getPositionSummary', () => {
  let manager: MultiExchangePositionManager;

  beforeEach(() => {
    manager = new MultiExchangePositionManager();
  });

  test('should return empty summary when no positions', async () => {
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue([]);

    const summary = await manager.getPositionSummary();

    expect(summary.totalPositions).toBe(0);
    expect(summary.byExchange.size).toBe(0);
    expect(summary.totalUnrealizedPnL).toBe(0);
    expect(summary.totalMarginUsed).toBe(0);
  });

  test('should count positions correctly', async () => {
    const positions: UnifiedPosition[] = [
      createMockPosition({ id: 'pos1', exchange: 'aster' }),
      createMockPosition({ id: 'pos2', exchange: 'aster' }),
      createMockPosition({ id: 'pos3', exchange: 'paradex' }),
    ];
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue(positions);

    const summary = await manager.getPositionSummary();

    expect(summary.totalPositions).toBe(3);
    expect(summary.byExchange.get('aster')).toBe(2);
    expect(summary.byExchange.get('paradex')).toBe(1);
  });

  test('should sum PnL correctly', async () => {
    const positions: UnifiedPosition[] = [
      createMockPosition({ unrealizedPnl: 10 }),
      createMockPosition({ unrealizedPnl: -5 }),
      createMockPosition({ unrealizedPnl: 15 }),
    ];
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue(positions);

    const summary = await manager.getPositionSummary();

    expect(summary.totalUnrealizedPnL).toBe(20);
  });

  test('should sum margin correctly', async () => {
    const positions: UnifiedPosition[] = [
      createMockPosition({ marginUsed: 50 }),
      createMockPosition({ marginUsed: 30 }),
      createMockPosition({ marginUsed: 20 }),
    ];
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue(positions);

    const summary = await manager.getPositionSummary();

    expect(summary.totalMarginUsed).toBe(100);
  });
});

// =============================================================================
// CALCULATE TOTAL EXPOSURE TESTS
// =============================================================================

describe('MultiExchangePositionManager.calculateTotalExposure', () => {
  let manager: MultiExchangePositionManager;

  beforeEach(() => {
    manager = new MultiExchangePositionManager();
  });

  test('should return 0 for no positions', async () => {
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue([]);

    const exposure = await manager.calculateTotalExposure();

    expect(exposure).toBe(0);
  });

  test('should calculate exposure from single position', async () => {
    const positions: UnifiedPosition[] = [
      createMockPosition({ size: 0.001, currentPrice: 50000 }),
    ];
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue(positions);

    const exposure = await manager.calculateTotalExposure();

    // 0.001 * 50000 = 50
    expect(exposure).toBe(50);
  });

  test('should sum exposure from multiple positions', async () => {
    const positions: UnifiedPosition[] = [
      createMockPosition({ size: 0.001, currentPrice: 50000 }), // 50
      createMockPosition({ size: 1.0, currentPrice: 2000 }),    // 2000
      createMockPosition({ size: 0.5, currentPrice: 100 }),     // 50
    ];
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue(positions);

    const exposure = await manager.calculateTotalExposure();

    expect(exposure).toBe(2100);
  });

  test('should handle fractional sizes and prices', async () => {
    const positions: UnifiedPosition[] = [
      createMockPosition({ size: 0.0125, currentPrice: 49750.50 }),
    ];
    jest.spyOn(manager, 'getAllUnifiedPositions').mockResolvedValue(positions);

    const exposure = await manager.calculateTotalExposure();

    expect(exposure).toBeCloseTo(621.88, 2);
  });
});
