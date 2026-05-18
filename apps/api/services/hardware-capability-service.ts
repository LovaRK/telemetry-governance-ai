import * as os from 'os';
import { execSync, spawnSync } from 'child_process';

export interface HardwareProfile {
  platform: 'macos' | 'linux_nvidia' | 'linux_cpu' | 'unknown';
  totalMemoryGB: number;
  availableMemoryGB: number;
  cpuCoreCount: number;
  cpuLoadAvg1Min: number;
  isThrottling: boolean;
  thermalLevel?: number; // 0-100, macOS specific
  gpuMemoryGB?: number; // discrete GPU VRAM
  estimatedTokensPerSec: number;
  lastUpdatedAt: Date;
}

export interface AdaptiveBudgetResult {
  effectiveBudget: number;
  baselineBudget: number;
  hardwareFactor: number;
  queueFactor: number;
  thermalFactor: number;
  explanation: string;
}

/**
 * Hardware capability profiling service
 * Continuously benchmarks host machine to feed adaptive budgeting
 * Detects: memory, CPU load, thermal throttling, GPU availability
 */
export class HardwareCapabilityService {
  // Baseline tokens/sec for local inference
  // Typical: Qwen 7B = 40-60 tok/s, Llama 2 7B = 35-45 tok/s
  private readonly BASE_TOKENS_PER_SEC = 45.0;

  // Cache profile to avoid excessive system calls
  private lastProfile: HardwareProfile | null = null;
  private lastProfileTime: number = 0;
  private readonly PROFILE_CACHE_MS = 5000; // Refresh every 5 seconds

  /**
   * Get current hardware profile
   * Returns cached profile if younger than PROFILE_CACHE_MS
   */
  async getProfile(): Promise<HardwareProfile> {
    const now = Date.now();
    if (this.lastProfile && now - this.lastProfileTime < this.PROFILE_CACHE_MS) {
      return this.lastProfile;
    }

    const profile = this.detectHardware();
    this.lastProfile = profile;
    this.lastProfileTime = now;
    return profile;
  }

  /**
   * Calculate adaptive reanalysis budget based on current system state
   */
  async getAdaptiveBudget(
    baseBudget: number,
    corpusSize: number,
    currentQueueDepth: number
  ): Promise<AdaptiveBudgetResult> {
    const profile = await this.getProfile();

    // μ_hardware: device capability scale
    // Range: 0.2 (laptop with 8GB) → 2.5 (enterprise GPU cluster)
    const hardwareFactor = this.calculateHardwareFactor(profile);

    // μ_queue: backlog pressure
    // Range: 0.1 (queue full) → 1.0 (queue empty)
    const maxAllowedBacklog = Math.ceil(corpusSize * 0.05); // 5% of corpus
    const queueFactor = Math.max(0.1, 1.0 - (currentQueueDepth / Math.max(maxAllowedBacklog, 10)));

    // μ_thermal: throttling detection
    // Range: 0.25 (severe throttling) → 1.0 (normal)
    const thermalFactor = profile.isThrottling ? 0.25 : 1.0;

    // Apply multiplicative constraint equation
    const effective = Math.ceil(baseBudget * hardwareFactor * queueFactor * thermalFactor);

    return {
      effectiveBudget: Math.max(1, effective), // At least 1 job/day
      baselineBudget: baseBudget,
      hardwareFactor,
      queueFactor: parseFloat(queueFactor.toFixed(2)),
      thermalFactor,
      explanation: `${baseBudget} base × hw:${hardwareFactor.toFixed(2)} × queue:${queueFactor.toFixed(2)} × thermal:${thermalFactor} = ${effective}`,
    };
  }

  /**
   * Detect platform and profile hardware
   */
  private detectHardware(): HardwareProfile {
    const platform = process.platform;
    const totalMemGB = os.totalmem() / (1024 * 1024 * 1024);
    const freeMemGB = os.freemem() / (1024 * 1024 * 1024);
    const availableMemGB = freeMemGB * 0.7; // Safety margin: use only 70%
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg()[0]; // 1-minute average

    if (platform === 'darwin') {
      return this.profileMacOS(totalMemGB, availableMemGB, cpuCount, loadAvg);
    } else if (platform === 'linux') {
      return this.profileLinux(totalMemGB, availableMemGB, cpuCount, loadAvg);
    } else {
      // Fallback for unknown platforms
      return {
        platform: 'unknown',
        totalMemoryGB: totalMemGB,
        availableMemoryGB: availableMemGB,
        cpuCoreCount: cpuCount,
        cpuLoadAvg1Min: loadAvg,
        isThrottling: loadAvg > cpuCount * 0.85,
        estimatedTokensPerSec: this.BASE_TOKENS_PER_SEC * 0.5,
        lastUpdatedAt: new Date(),
      };
    }
  }

  /**
   * macOS-specific profiling (Apple Silicon & Intel)
   */
  private profileMacOS(
    totalMemGB: number,
    availableMemGB: number,
    cpuCount: number,
    loadAvg: number
  ): HardwareProfile {
    let thermalLevel: number | undefined;
    let isThrottling = false;

    try {
      // Query thermal level (0-100)
      const thermalOutput = execSync('sysctl -n hw.thermal.level', {
        encoding: 'utf8',
        timeout: 1000,
      });
      thermalLevel = parseInt(thermalOutput.trim(), 10);

      // Throttling threshold: any thermal level > 50 or load > 85% CPU
      isThrottling = thermalLevel > 50 || loadAvg > cpuCount * 0.85;
    } catch (e) {
      // Fallback if sysctl fails
      isThrottling = loadAvg > cpuCount * 0.85;
    }

    // Estimate tokens/sec based on thermal state
    let tokensPerSec = this.BASE_TOKENS_PER_SEC;
    if (isThrottling) {
      tokensPerSec *= 0.3; // Reduce to 30% during throttling
    } else if (availableMemGB < 8) {
      tokensPerSec *= 0.6; // Reduce to 60% on memory pressure
    } else if (availableMemGB > 48) {
      tokensPerSec *= 1.3; // Boost to 130% on high-memory systems
    }

    return {
      platform: 'macos',
      totalMemoryGB: totalMemGB,
      availableMemoryGB: availableMemGB,
      cpuCoreCount: cpuCount,
      cpuLoadAvg1Min: loadAvg,
      thermalLevel,
      isThrottling,
      estimatedTokensPerSec: parseFloat(tokensPerSec.toFixed(1)),
      lastUpdatedAt: new Date(),
    };
  }

  /**
   * Linux profiling (NVIDIA GPU or CPU-only)
   */
  private profileLinux(
    totalMemGB: number,
    availableMemGB: number,
    cpuCount: number,
    loadAvg: number
  ): HardwareProfile {
    let gpuMemoryGB: number | undefined;
    let isThrottling = loadAvg > cpuCount * 0.85;

    try {
      // Check for NVIDIA GPU
      const gpuQuery = execSync(
        'nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits',
        { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }
      );
      const gpuMemMB = parseInt(gpuQuery.trim().split('\n')[0], 10);
      gpuMemoryGB = gpuMemMB / 1024;

      // Check for GPU throttling
      try {
        const throttleQuery = execSync(
          'nvidia-smi --query-gpu=clocks_throttle_reasons.active --format=csv,noheader',
          { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }
        );
        // If any throttle reason is active (non-"None"), set throttling flag
        const throttleReason = throttleQuery.trim();
        if (throttleReason && throttleReason !== 'None') {
          isThrottling = true;
        }
      } catch (e) {
        // nvidia-smi throttle query failed, use CPU load fallback
      }
    } catch (e) {
      // No NVIDIA GPU, CPU-only mode
    }

    let tokensPerSec = this.BASE_TOKENS_PER_SEC;
    if (isThrottling) {
      tokensPerSec *= 0.3;
    } else if (gpuMemoryGB && gpuMemoryGB > 20) {
      tokensPerSec *= 1.5; // High-end GPU
    } else if (gpuMemoryGB && gpuMemoryGB > 8) {
      tokensPerSec *= 1.2; // Mid-range GPU
    } else if (!gpuMemoryGB) {
      tokensPerSec *= 0.4; // CPU-only is slow
    }

    return {
      platform: gpuMemoryGB ? 'linux_nvidia' : 'linux_cpu',
      totalMemoryGB: totalMemGB,
      availableMemoryGB: availableMemGB,
      cpuCoreCount: cpuCount,
      cpuLoadAvg1Min: loadAvg,
      gpuMemoryGB,
      isThrottling,
      estimatedTokensPerSec: parseFloat(tokensPerSec.toFixed(1)),
      lastUpdatedAt: new Date(),
    };
  }

  /**
   * Calculate hardware factor (μ_hardware)
   * Range: 0.2 (constrained) → 2.5 (enterprise)
   */
  private calculateHardwareFactor(profile: HardwareProfile): number {
    // Base factor from available memory
    let factor = 1.0;

    if (profile.availableMemoryGB < 8) {
      factor = 0.2; // Laptop, severely constrained
    } else if (profile.availableMemoryGB < 16) {
      factor = 0.4; // Consumer laptop
    } else if (profile.availableMemoryGB < 32) {
      factor = 0.7; // Lower mid-range
    } else if (profile.availableMemoryGB < 64) {
      factor = 1.0; // Standard workstation
    } else if (profile.availableMemoryGB < 128) {
      factor = 1.5; // High-end workstation
    } else {
      factor = 2.5; // Enterprise (GPU cluster, server)
    }

    // GPU boost for discrete GPU systems
    if (profile.gpuMemoryGB) {
      if (profile.gpuMemoryGB > 24) factor *= 1.8;
      else if (profile.gpuMemoryGB > 12) factor *= 1.5;
      else if (profile.gpuMemoryGB > 8) factor *= 1.3;
    }

    // Throttling penalty
    if (profile.isThrottling) {
      factor *= 0.5;
    }

    return parseFloat(factor.toFixed(2));
  }

  /**
   * Explain current hardware constraints in human terms
   */
  async explain(): Promise<string> {
    const profile = await this.getProfile();
    const lines: string[] = [];

    lines.push(`Platform: ${profile.platform}`);
    lines.push(`Total Memory: ${profile.totalMemoryGB.toFixed(1)}GB`);
    lines.push(`Available Memory: ${profile.availableMemoryGB.toFixed(1)}GB`);
    lines.push(`CPU Cores: ${profile.cpuCoreCount}`);
    lines.push(`Load Average (1m): ${profile.cpuLoadAvg1Min.toFixed(2)}`);
    lines.push(`Est. Tokens/sec: ${profile.estimatedTokensPerSec.toFixed(1)}`);

    if (profile.thermalLevel !== undefined) {
      lines.push(`Thermal Level: ${profile.thermalLevel}%`);
    }

    if (profile.gpuMemoryGB !== undefined) {
      lines.push(`GPU VRAM: ${profile.gpuMemoryGB.toFixed(1)}GB`);
    }

    if (profile.isThrottling) {
      lines.push(`⚠️ System Throttling: YES - reducing inference workload`);
    } else {
      lines.push(`System Throttling: NO`);
    }

    lines.push(`Last Updated: ${profile.lastUpdatedAt.toISOString()}`);

    return lines.join('\n');
  }
}

/**
 * Singleton instance for application-wide access
 */
let globalService: HardwareCapabilityService | null = null;

export function getHardwareCapabilityService(): HardwareCapabilityService {
  if (!globalService) {
    globalService = new HardwareCapabilityService();
  }
  return globalService;
}

/**
 * Convenience function for getting budget in one call
 */
export async function calculateAdaptiveReanalysisBudget(
  baseBudgetCount: number,
  corpusSize: number,
  currentQueueDepth: number
): Promise<AdaptiveBudgetResult> {
  const service = getHardwareCapabilityService();
  return service.getAdaptiveBudget(baseBudgetCount, corpusSize, currentQueueDepth);
}
