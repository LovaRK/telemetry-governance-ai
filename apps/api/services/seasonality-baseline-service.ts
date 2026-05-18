import { PoolClient } from 'pg';

export type TimeClass =
  | 'WEEKDAY'
  | 'WEEKEND'
  | 'MONTH_START'
  | 'MONTH_END'
  | 'QUARTER_END'
  | 'PATCH_TUESDAY'
  | 'HOLIDAY_WINDOW'
  | 'AUDIT_WINDOW'
  | 'GENERAL';

export interface SeasonalBaseline {
  indexName: string;
  timeClass: TimeClass;
  volumeEma: number;
  volumeStddev: number;
  utilizationP95: number;
  lastCalibratedAt: Date;
}

export interface TimeWindowProfile {
  timeClass: TimeClass;
  description: string;
  expectedVolumeFactor: number; // Relative to average
  expectedUtilizationFactor: number;
  highVariance: boolean;
}

/**
 * Seasonality-aware baseline service
 * Tracks periodic patterns to distinguish legitimate spikes from drift
 * Examples: Patch Tuesday, month-end, quarter-end, audits, Black Friday, year-end freeze
 */
export class SeasonalityBaselineService {
  /**
   * Determine time class for current date
   * Used to select appropriate baseline envelope
   */
  getTimeClass(date: Date = new Date()): TimeClass {
    const day = date.getDay(); // 0=Sunday, 1=Monday, ...
    const dateOfMonth = date.getDate();
    const month = date.getMonth(); // 0=January, ...
    const dayOfWeek = date.getDay();

    // PATCH TUESDAY: 2nd Tuesday of month (typical MS/Linux patch cycle)
    if (this.isPatchTuesday(date)) {
      return 'PATCH_TUESDAY';
    }

    // MONTH_END: Last 3 days of month (reconciliation, reporting)
    if (dateOfMonth >= 28 && dateOfMonth <= 31) {
      return 'MONTH_END';
    }

    // MONTH_START: First 2 days of month
    if (dateOfMonth <= 2) {
      return 'MONTH_START';
    }

    // QUARTER_END: Last week of Mar, Jun, Sep, Dec (compliance, financial close)
    if (this.isQuarterEnd(date)) {
      return 'QUARTER_END';
    }

    // HOLIDAY_WINDOW: 2 weeks before Christmas, New Year's Eve/Day
    if (this.isHolidayWindow(date)) {
      return 'HOLIDAY_WINDOW';
    }

    // AUDIT_WINDOW: Quarterly audit periods (month 1, 4, 7, 10 = start of quarters)
    // Orgs often run compliance audits at quarter boundaries
    if ((month + 1) % 3 === 1 && dateOfMonth <= 14) {
      return 'AUDIT_WINDOW';
    }

    // WEEKEND vs WEEKDAY
    if (day === 0 || day === 6) {
      return 'WEEKEND';
    }

    return 'WEEKDAY';
  }

  /**
   * Get expected behavior profile for a time class
   */
  getTimeWindowProfile(timeClass: TimeClass): TimeWindowProfile {
    const profiles: Record<TimeClass, TimeWindowProfile> = {
      WEEKDAY: {
        timeClass: 'WEEKDAY',
        description: 'Normal business day (Mon-Fri)',
        expectedVolumeFactor: 1.0,
        expectedUtilizationFactor: 1.0,
        highVariance: false,
      },
      WEEKEND: {
        timeClass: 'WEEKEND',
        description: 'Weekend (Sat-Sun)',
        expectedVolumeFactor: 0.3, // Reduced traffic on weekends
        expectedUtilizationFactor: 0.2,
        highVariance: true,
      },
      MONTH_START: {
        timeClass: 'MONTH_START',
        description: 'First days of month',
        expectedVolumeFactor: 1.1,
        expectedUtilizationFactor: 1.1,
        highVariance: true,
      },
      MONTH_END: {
        timeClass: 'MONTH_END',
        description: 'Last 3 days of month (reconciliation, reporting spike)',
        expectedVolumeFactor: 1.8, // 80% above average
        expectedUtilizationFactor: 2.2, // High query activity
        highVariance: true,
      },
      QUARTER_END: {
        timeClass: 'QUARTER_END',
        description: 'Quarter-end close (compliance & financial reporting)',
        expectedVolumeFactor: 2.5, // Significant spike
        expectedUtilizationFactor: 3.0,
        highVariance: true,
      },
      PATCH_TUESDAY: {
        timeClass: 'PATCH_TUESDAY',
        description: 'Patch Tuesday (2nd Tue of month - system updates)',
        expectedVolumeFactor: 1.4,
        expectedUtilizationFactor: 1.8,
        highVariance: true,
      },
      HOLIDAY_WINDOW: {
        timeClass: 'HOLIDAY_WINDOW',
        description: 'Holiday period (reduced operations, automation testing)',
        expectedVolumeFactor: 0.5,
        expectedUtilizationFactor: 1.5, // Automation runs while humans away
        highVariance: true,
      },
      AUDIT_WINDOW: {
        timeClass: 'AUDIT_WINDOW',
        description: 'Quarterly audit period',
        expectedVolumeFactor: 2.0,
        expectedUtilizationFactor: 2.5,
        highVariance: true,
      },
      GENERAL: {
        timeClass: 'GENERAL',
        description: 'General purpose baseline',
        expectedVolumeFactor: 1.0,
        expectedUtilizationFactor: 1.0,
        highVariance: false,
      },
    };

    return profiles[timeClass];
  }

  /**
   * Get or create seasonal baseline for an index
   */
  async getOrCreateSeasonalBaseline(
    client: PoolClient,
    indexName: string,
    timeClass: TimeClass,
    defaultVolume: number = 100,
    defaultUtilization: number = 50
  ): Promise<SeasonalBaseline> {
    const result = await client.query(
      `SELECT * FROM index_seasonal_baselines WHERE index_name = $1 AND time_class = $2`,
      [indexName, timeClass]
    );

    if (result.rows.length > 0) {
      return parseSeasonalBaseline(result.rows[0]);
    }

    // Create new seasonal baseline
    const newResult = await client.query(
      `INSERT INTO index_seasonal_baselines (
        index_name, time_class,
        volume_ema, volume_stddev, utilization_p95,
        last_calibrated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        indexName,
        timeClass,
        defaultVolume,
        defaultVolume * 0.15, // Initial stddev = 15% of mean
        defaultUtilization,
        new Date(),
      ]
    );

    return parseSeasonalBaseline(newResult.rows[0]);
  }

  /**
   * Update seasonal baseline with new observation
   */
  async updateSeasonalBaseline(
    client: PoolClient,
    indexName: string,
    timeClass: TimeClass,
    observedVolume: number,
    observedUtilization: number
  ): Promise<SeasonalBaseline> {
    const baseline = await this.getOrCreateSeasonalBaseline(
      client,
      indexName,
      timeClass,
      observedVolume,
      observedUtilization
    );

    // Update EMA and stddev
    const alpha = 0.12; // Standard EMA smoothing
    const newEma = alpha * observedVolume + (1 - alpha) * baseline.volumeEma;
    const deviation = observedVolume - newEma;
    const newStddev = Math.sqrt(alpha * (deviation * deviation) + (1 - alpha) * (baseline.volumeStddev ** 2));

    // Update utilization P95 (rolling percentile)
    const newUtilP95 = Math.max(observedUtilization, baseline.utilizationP95 * 0.9 + observedUtilization * 0.1);

    const result = await client.query(
      `UPDATE index_seasonal_baselines SET
        volume_ema = $1,
        volume_stddev = $2,
        utilization_p95 = $3,
        last_calibrated_at = NOW()
      WHERE index_name = $4 AND time_class = $5
      RETURNING *`,
      [newEma, newStddev, newUtilP95, indexName, timeClass]
    );

    return parseSeasonalBaseline(result.rows[0]);
  }

  /**
   * Check if current metric violates seasonal envelope
   * Returns null if within bounds, violation details if exceeded
   */
  async checkSeasonalViolation(
    client: PoolClient,
    indexName: string,
    observedVolume: number,
    observedUtilization: number,
    kFactor: number = 3.0
  ): Promise<
    | {
        violatesSeasonalEnvelope: true;
        timeClass: TimeClass;
        volumeSigmaDistance: number;
        utilizationSigmaDistance: number;
        explanation: string;
      }
    | { violatesSeasonalEnvelope: false }
  > {
    const timeClass = this.getTimeClass();
    const baseline = await this.getOrCreateSeasonalBaseline(client, indexName, timeClass, observedVolume, observedUtilization);

    // Volume check
    const volumeLowerBound = baseline.volumeEma - kFactor * baseline.volumeStddev;
    const volumeUpperBound = baseline.volumeEma + kFactor * baseline.volumeStddev;
    const volumeViolation = observedVolume < volumeLowerBound || observedVolume > volumeUpperBound;

    let volumeSigmaDistance = 0;
    if (volumeViolation) {
      volumeSigmaDistance =
        observedVolume < volumeLowerBound
          ? Math.abs(observedVolume - volumeLowerBound) / baseline.volumeStddev
          : Math.abs(observedVolume - volumeUpperBound) / baseline.volumeStddev;
    }

    // Utilization check (P95-based)
    const utilizationViolation = observedUtilization > baseline.utilizationP95 * 1.5;
    let utilizationSigmaDistance = 0;
    if (utilizationViolation) {
      utilizationSigmaDistance = (observedUtilization - baseline.utilizationP95) / (baseline.utilizationP95 * 0.1);
    }

    if (volumeViolation || utilizationViolation) {
      return {
        violatesSeasonalEnvelope: true,
        timeClass,
        volumeSigmaDistance,
        utilizationSigmaDistance,
        explanation: `Seasonal envelope violation on ${timeClass}: volume ${volumeSigmaDistance.toFixed(1)}σ, utilization ${utilizationSigmaDistance.toFixed(1)}σ`,
      };
    }

    return { violatesSeasonalEnvelope: false };
  }

  /**
   * Is this Patch Tuesday? (2nd Tuesday of the month)
   */
  private isPatchTuesday(date: Date): boolean {
    const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, 2=Tuesday
    if (dayOfWeek !== 2) return false; // Not a Tuesday

    const dateOfMonth = date.getDate();
    // 2nd Tuesday is between 8-14
    return dateOfMonth >= 8 && dateOfMonth <= 14;
  }

  /**
   * Is this quarter-end?
   */
  private isQuarterEnd(date: Date): boolean {
    const dateOfMonth = date.getDate();
    const month = date.getMonth(); // 0=Jan, 3=Apr, 6=Jul, 9=Oct

    // Last week of Mar(2), Jun(5), Sep(8), Dec(11)
    if ([2, 5, 8, 11].includes(month)) {
      return dateOfMonth >= 24; // Last week of month
    }
    return false;
  }

  /**
   * Is this holiday window?
   */
  private isHolidayWindow(date: Date): boolean {
    const month = date.getMonth(); // 0=Jan, 11=Dec
    const dateOfMonth = date.getDate();

    // Christmas window: Dec 12 - Jan 3
    if (month === 11 && dateOfMonth >= 12) return true; // Dec 12+
    if (month === 0 && dateOfMonth <= 3) return true; // Jan 1-3

    return false;
  }
}

/**
 * Parse database row into SeasonalBaseline
 */
function parseSeasonalBaseline(row: any): SeasonalBaseline {
  return {
    indexName: row.index_name,
    timeClass: row.time_class,
    volumeEma: parseFloat(row.volume_ema),
    volumeStddev: parseFloat(row.volume_stddev),
    utilizationP95: parseFloat(row.utilization_p95),
    lastCalibratedAt: new Date(row.last_calibrated_at),
  };
}

/**
 * Singleton instance
 */
let globalService: SeasonalityBaselineService | null = null;

export function getSeasonalityBaselineService(): SeasonalityBaselineService {
  if (!globalService) {
    globalService = new SeasonalityBaselineService();
  }
  return globalService;
}
