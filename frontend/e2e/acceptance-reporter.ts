import type { FullResult, Reporter, TestCase, TestError, TestResult } from '@playwright/test/reporter';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// No raw traces/HAR/cookies or built-in JSON error serialization in live evidence.
export default class AcceptanceReporter implements Reporter {
  private secrets: string[];
  private tests: unknown[] = [];
  private errors: string[] = [];
  constructor(private options: { outputFile: string; manifestPath?: string }) {
    const file = options.manifestPath || process.env.IRM_ACCEPTANCE_MANIFEST;
    const manifest = file ? JSON.parse(readFileSync(file, 'utf8')) : { actors: {} };
    this.secrets = [process.env.IRM_ACCEPTANCE_DB_PASSWORD || '',
      ...Object.values(manifest.actors as Record<string, { password: string }>).map(actor => actor.password)].filter(Boolean);
  }
  private redact(value: string) {
    for (const secret of this.secrets) value = value.replaceAll(secret, '[redacted]');
    return value.replace(/postgresql(?:\+\w+)?:\/\/[^\s'"<>]+/g, '[redacted database URL]')
      .replace(/^.*(?:set-cookie|\bcookies?\b|token_hash|session=).*$/gim, '[redacted cookie detail]');
  }
  onError(error: TestError) { this.errors.push(this.redact(error.message || 'Runner error')); }
  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.push({ title: this.redact(test.titlePath().join(' / ')), status: result.status,
      duration_ms: result.duration, errors: result.errors.map(error => this.redact(error.message || 'Test error')),
      screenshots: result.attachments.filter(item => item.contentType === 'image/png').map(item => item.path) });
  }
  onEnd(result: FullResult) {
    mkdirSync(dirname(this.options.outputFile), { recursive: true, mode: 0o700 });
    writeFileSync(this.options.outputFile, JSON.stringify({ status: result.status, duration_ms: result.duration,
      tests: this.tests, errors: this.errors }, null, 2), { mode: 0o600 });
  }
}
