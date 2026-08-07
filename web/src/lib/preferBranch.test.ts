import { describe, expect, test } from 'bun:test';
import { displayPackageVersion, resolvePreferBranchDisplay } from './preferBranch';
import type { Package } from './types';

const basePkg = (over: Partial<Package> = {}): Package => ({
	name: 'js-debug-adapter',
	source: { id: 'github:microsoft/vscode-js-debug' },
	description: '',
	version: 'v1.117.0',
	homepage: '',
	licenses: [],
	categories: [],
	...over
});

describe('resolvePreferBranchDisplay', () => {
	test('prefers main when tag is older than 60d and branch is newer', () => {
		const now = Date.parse('2026-08-07T12:00:00Z');
		const pkg = basePkg({
			git: {
				fetched_at_unix: Math.floor(now / 1000),
				refs: [
					{
						ref: 'main',
						kind: 'branch',
						commit: '06ce1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
						commit_date_unix: Math.floor(Date.parse('2026-08-06T12:00:00Z') / 1000)
					},
					{
						ref: 'v1.117.0',
						kind: 'tag',
						commit: '496a6f1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
						commit_date_unix: Math.floor(Date.parse('2026-04-18T12:00:00Z') / 1000)
					}
				]
			}
		});
		const got = resolvePreferBranchDisplay(pkg, now);
		expect(got.usedBranch).toBe(true);
		expect(got.version).toBe('main (06ce1aa)');
		expect(got.supersededTag).toBe('v1.117.0');
		expect(displayPackageVersion(pkg, now)).toBe('main (06ce1aa)');
	});

	test('keeps tag when within gap', () => {
		const now = Date.parse('2026-08-07T12:00:00Z');
		const pkg = basePkg({
			version: 'v1.118.0',
			git: {
				fetched_at_unix: Math.floor(now / 1000),
				refs: [
					{
						ref: 'main',
						kind: 'branch',
						commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
						commit_date_unix: Math.floor(Date.parse('2026-08-06T12:00:00Z') / 1000)
					},
					{
						ref: 'v1.118.0',
						kind: 'tag',
						commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
						commit_date_unix: Math.floor(Date.parse('2026-07-20T12:00:00Z') / 1000)
					}
				]
			}
		});
		expect(resolvePreferBranchDisplay(pkg, now)).toEqual({
			version: 'v1.118.0',
			usedBranch: false
		});
	});

	test('falls back to package.version without git refs', () => {
		expect(displayPackageVersion(basePkg())).toBe('v1.117.0');
	});
});
