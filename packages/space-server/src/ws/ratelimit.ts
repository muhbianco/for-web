/**
 * Token bucket per connection: 20 messages/s, bursts of 40 (docs/espaco §F.5).
 * Sustained abuse (bucket empty for longer than `abuseMs` of rejections in a
 * row) means the connection should be closed.
 */
export class TokenBucket {
  private tokens: number;
  private at: number;
  private firstRejectAt: number | null = null;

  private readonly rate: number;
  private readonly burst: number;
  private readonly abuseMs: number;

  constructor(rate = 20, burst = 40, abuseMs = 10_000, now = Date.now()) {
    this.rate = rate;
    this.burst = burst;
    this.abuseMs = abuseMs;
    this.tokens = burst;
    this.at = now;
  }

  /** "ok", "drop" (reject this message) or "abuse" (close the connection). */
  take(now = Date.now()): "ok" | "drop" | "abuse" {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.firstRejectAt = null;
      return "ok";
    }
    this.firstRejectAt ??= now;
    return now - this.firstRejectAt >= this.abuseMs ? "abuse" : "drop";
  }
}
