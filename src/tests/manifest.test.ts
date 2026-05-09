/**
 * TEST FILE: Manifest Hardening Regression Tests
 *
 * Test Type: Unit
 * Contexts Tested: Manifest (global config)
 * Chrome APIs Mocked: None (JSON validation only)
 * Prerequisites:
 *   - Ensure production manifest is up to date in `src/manifest.json`
 *
 * Coverage Target: Validate manifest security constraints for WARS/matches/permissions
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const manifestPath = path.resolve(path.dirname(__filename), '../manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

describe('manifest security hardening', () => {
  it('should expose only the intended resources via WARS', () => {
    const wars = manifest.web_accessible_resources?.[0];
    expect(wars).toBeTruthy();
    expect(wars.resources).toEqual(['data/privacy-rules.json']);
  });

  it('should restrict web accessible matches to http/https and avoid <all_urls>', () => {
    const matches = manifest.web_accessible_resources?.[0]?.matches ?? [];
    expect(matches).toEqual(['http://*/*', 'https://*/*']);
    expect(matches).not.toContain('<all_urls>');
  });

  it('should limit host permissions to the Supabase deployment only', () => {
    expect(manifest.host_permissions).toEqual([
      'https://llffqxdhpgsqnpzeznaq.supabase.co/*',
    ]);
  });

  it('should avoid dangerous permissions like webRequestBlocking', () => {
    expect(manifest.permissions).not.toContain('webRequestBlocking');
    expect(manifest.permissions).not.toContain('<all_urls>');
  });
});
