<script lang="ts">
	import type { Package } from './types';
	import {
		buildRowTitle,
		collectPackageExtraDetails,
		formatExternalQueryLine,
		normalizePackageRef
	} from './packageDetails';

	export let pkg: Package;
	/** Open another package's details modal (e.g. from requires links). */
	export let onNavigatePackage: ((sourceId: string) => void) | undefined = undefined;

	$: extra = collectPackageExtraDetails(pkg);

	const navigate = (ref: string) => {
		const id = normalizePackageRef(ref);
		onNavigatePackage?.(id);
	};
</script>

{#if extra.requires}
	<tr>
		<td colspan="2" class="align-top">
			<div class="border-base-300 bg-base-200/50 rounded-box border p-4">
				<h4 class="mb-2 font-semibold">Requires</h4>
				{#if extra.requires.all.length > 0}
					<p class="text-base-content/80 mb-1 text-sm">
						<strong>All of</strong> - every package must be installed:
					</p>
					<ul class="list-disc space-y-1 ps-5 text-sm">
						{#each extra.requires.all as ref (ref)}
							<li>
								{#if onNavigatePackage}
									<button
										type="button"
										class="link link-primary text-left font-mono"
										on:click={() => navigate(ref)}
									>
										{ref}
									</button>
								{:else}
									<code class="text-xs">{ref}</code>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if extra.requires.one.length > 0}
					<p class="text-base-content/80 mt-3 mb-1 text-sm">
						<strong>One of</strong> - at least one must be installed:
					</p>
					<ul class="list-disc space-y-1 ps-5 text-sm">
						{#each extra.requires.one as ref (ref)}
							<li>
								{#if onNavigatePackage}
									<button
										type="button"
										class="link link-primary text-left font-mono"
										on:click={() => navigate(ref)}
									>
										{ref}
									</button>
								{:else}
									<code class="text-xs">{ref}</code>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</td>
	</tr>
{/if}

{#if extra.treeSitter}
	<tr>
		<td colspan="2" class="align-top">
			<div class="border-base-300 bg-base-200/50 rounded-box border p-4">
				<h4 class="mb-2 font-semibold">Tree-sitter</h4>
				{#if extra.treeSitter.languages.length > 0}
					<p class="text-sm">
						<span class="font-medium">Languages installed:</span>
						{extra.treeSitter.languages.join(', ')}
					</p>
				{/if}
				{#if extra.treeSitter.integrations.length > 0}
					<p class="mt-2 text-sm">
						<span class="font-medium">Supported integrations:</span>
						{extra.treeSitter.integrations.join(', ')}
					</p>
				{/if}
				<div class="mt-3 space-y-3">
					{#each extra.treeSitter.build as row (row.language + row.queriesOnly)}
						<div class="border-base-300 rounded-box bg-base-100 border p-3">
							<p class="font-medium">{buildRowTitle(row)}</p>
							<ul class="text-base-content/90 mt-2 space-y-1 text-sm">
								{#if row.grammarDir && !row.queriesOnly}
									<li>
										<span class="font-medium">Grammar directory:</span>
										<code class="text-xs">{row.grammarDir}</code>
									</li>
								{/if}
								{#if row.integrations.length > 0}
									<li>
										<span class="font-medium">Integrations:</span>
										{row.integrations.join(', ')}
									</li>
								{/if}
								{#if row.inherits.length > 0}
									<li>
										<span class="font-medium">Inherits:</span>
										{row.inherits.join(', ')}
									</li>
								{/if}
								{#if row.externalQueries.length > 0}
									<li>
										<span class="font-medium">External queries (optional):</span>
										<ul class="mt-1 list-disc ps-5">
											{#each row.externalQueries as q (q.repoURL)}
												<li>
													<a
														class="link link-hover text-xs break-all"
														href={q.repoURL}
														target="_blank"
														rel="noopener noreferrer"
													>
														{formatExternalQueryLine(q)}
													</a>
												</li>
											{/each}
										</ul>
									</li>
								{/if}
							</ul>
						</div>
					{/each}
				</div>
			</div>
		</td>
	</tr>
{/if}
