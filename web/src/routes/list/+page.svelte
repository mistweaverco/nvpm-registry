<script lang="ts">
	import Head from '$lib/head.svelte';
	import { onMount } from 'svelte';
	import { type Package, PackageTreesitterIntegration } from '$lib/types';
	import TagFilter from '$lib/TagFilter.svelte';
	import PackageInfoExtra from '$lib/PackageInfoExtra.svelte';
	import { pushState, replaceState } from '$app/navigation';
	import { browser } from '$app/environment';

	let modalInfo: HTMLDialogElement;
	let modalInfoCloseButton: HTMLButtonElement;
	let activePackageIndex = 0;
	let packages: Package[] = [];
	let filteredPackages: Package[] = [];
	let availableLanguages: string[] = [];
	let availableCategories: string[] = [];

	let activePackageData: Package = {
		name: '',
		source: {
			id: ''
		},
		description: '',
		version: '',
		homepage: '',
		licenses: [],
		categories: []
	};

	let activePackageDataInstallCommand = '';

	let query = '';
	let selectedLanguages: string[] = [];
	let selectedCategories: string[] = [];
	let languageInput = '';
	let categoryInput = '';
	let detailsId: string | null = null;
	let lastUrlSearch = '';
	let suppressNextUrlToStateSync = false;

	let copySuccessMessage = '';
	let showCopySuccess = false;

	const truncateVersion = (v: string, maxLen = 12) =>
		v.length > maxLen ? `${v.slice(0, maxLen)}…` : v;

	const uniqSorted = (values: string[]) =>
		Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

	/** Keep first-seen casing; drop duplicates that only differ by case. */
	const dedupeInsensitiveSorted = (values: string[]): string[] => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const v of values) {
			const k = v.toLowerCase();
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(v);
		}
		return out.sort((a, b) => a.localeCompare(b));
	};

	/** Prefer registry spelling when the pool has a case-insensitive match. */
	const canonicalizeAgainstPool = (selected: string[], pool: string[]): string[] => {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const raw of selected) {
			const t = raw.trim();
			if (!t) continue;
			const canon = pool.find((p) => p.toLowerCase() === t.toLowerCase()) ?? t;
			const k = canon.toLowerCase();
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(canon);
		}
		return out.sort((a, b) => a.localeCompare(b));
	};

	$: availableLanguages = uniqSorted(packages.flatMap((p) => p.languages ?? []));
	$: availableCategories = uniqSorted(packages.flatMap((p) => p.categories ?? []));
	$: if (detailsId && activePackageData) {
		activePackageDataInstallCommand = getNvpmInstallCommand(
			activePackageData,
			PackageTreesitterIntegration.Neovim
		);
	}

	const getCurrentSearch = () => (browser ? window.location.search : '');
	const getCurrentSearchParams = () => new URLSearchParams(getCurrentSearch());

	const applySearchParams = (next: URLSearchParams, mode: 'push' | 'replace' = 'push') => {
		const url = new URL(browser ? window.location.href : '');
		url.search = next.toString();
		suppressNextUrlToStateSync = true;
		if (mode === 'replace') replaceState(url, {});
		else pushState(url, {});
		lastUrlSearch = url.search;
	};

	const onHomepageIconClick = (e: Event) => {
		const target = e.currentTarget as HTMLElement;
		const btn = target.closest('button') as HTMLSpanElement;
		const homepage = btn.dataset.homepage as string;
		window.open(homepage, '_blank');
	};

	const onAttrCopyClick = (e: Event) => {
		const target = e.currentTarget as HTMLElement;
		const btn = target.closest('button') as HTMLButtonElement;
		const v = (btn.dataset.copyValue ?? '') as string;
		if (!v) return;

		navigator.clipboard.writeText(v);
		copySuccessMessage = 'Successfully copied to clipboard';
		showCopySuccess = true;
		setTimeout(() => {
			showCopySuccess = false;
		}, 2000);
	};

	const openDetails = (pkgId: string) => {
		// Prefer the currently visible list index (for row highlighting),
		// but fall back to the full dataset so deep-links always work.
		const visibleIdx = filteredPackages.findIndex((p) => p.source.id === pkgId);
		const allIdx = packages.findIndex((p) => p.source.id === pkgId);
		if (visibleIdx === -1 && allIdx === -1) return;

		if (visibleIdx !== -1) activePackageIndex = visibleIdx;
		activePackageData = (
			visibleIdx !== -1 ? filteredPackages[visibleIdx] : packages[allIdx]
		) as Package;

		if (!modalInfo.open) modalInfo.showModal();
		modalInfoCloseButton.focus();
	};

	const removeDetailsParam = async () => {
		const next = getCurrentSearchParams();
		next.delete('details');
		applySearchParams(next, 'push');
	};

	const closeDetails = async () => {
		detailsId = null;
		if (modalInfo.open) modalInfo.close();
		await removeDetailsParam();
	};

	const onModalCancel = async (e: Event) => {
		// ESC key: keep dialog state and URL in sync.
		e.preventDefault();
		await closeDetails();
	};

	const getNvpmInstallCommand = (pkg: Package, integration: PackageTreesitterIntegration) => {
		if (pkg.treesitter && integration !== PackageTreesitterIntegration.None) {
			return `nvpm add --integrate ${integration} ${pkg.source.id}`;
		}
		return `nvpm add ${pkg.source.id}`;
	};

	const onChangeTreesitterIntegration = (e: Event) => {
		const select = e.currentTarget as HTMLSelectElement;
		const integration = select.value as PackageTreesitterIntegration;
		activePackageDataInstallCommand = getNvpmInstallCommand(activePackageData, integration);
	};

	const navigateToPackageDetails = (pkgId: string) => {
		detailsId = pkgId;
		openDetails(pkgId);
		const next = getCurrentSearchParams();
		next.set('details', pkgId);
		applySearchParams(next, 'push');
	};

	const onRemotePackageItemClick = (e: Event) => {
		const target = e.currentTarget as HTMLElement;
		const tr = target.closest('tr') as HTMLTableRowElement;
		const pkgId = tr.dataset.packageId as string;

		// Open immediately for responsive UX.
		navigateToPackageDetails(pkgId);
	};

	const filterPackages = () => {
		const q = query.trim().toLowerCase();
		let pkgs = packages;

		if (q !== '') {
			pkgs = pkgs.filter((pkg) => {
				// Search by name
				if (pkg.name.toLowerCase().includes(q)) {
					pkg.searchMatchInfo = 'Name matched';
					return true;
				}
				// Search by aliases
				if (pkg.aliases && Array.isArray(pkg.aliases)) {
					const aliasMatch = pkg.aliases.find((alias: string) => alias.toLowerCase().includes(q));
					if (aliasMatch !== undefined) {
						pkg.searchMatchInfo = `Alias ${aliasMatch} matched`;
						return true;
					}
				}
				const langMatch = (pkg.languages ?? []).find((l) => l.toLowerCase().includes(q));
				if (langMatch !== undefined) {
					pkg.searchMatchInfo = `Language matched (${langMatch})`;
					return true;
				}
				const catMatch = (pkg.categories ?? []).find((c) => c.toLowerCase().includes(q));
				if (catMatch !== undefined) {
					pkg.searchMatchInfo = `Category matched (${catMatch})`;
					return true;
				}
				return false;
			});
		}

		if (selectedLanguages.length > 0) {
			const want = new Set(selectedLanguages.map((v) => v.toLowerCase()));
			pkgs = pkgs.filter((pkg) => (pkg.languages ?? []).some((l) => want.has(l.toLowerCase())));
		}

		if (selectedCategories.length > 0) {
			const want = new Set(selectedCategories.map((v) => v.toLowerCase()));
			pkgs = pkgs.filter((pkg) => (pkg.categories ?? []).some((c) => want.has(c.toLowerCase())));
		}
		filteredPackages = pkgs.length !== packages.length ? pkgs : [];
	};

	const syncStateFromUrl = () => {
		const sp = getCurrentSearchParams();
		query = sp.get('q') ?? '';
		selectedLanguages = dedupeInsensitiveSorted(sp.getAll('lang').filter(Boolean));
		selectedCategories = dedupeInsensitiveSorted(sp.getAll('cat').filter(Boolean));
		if (packages.length > 0) {
			selectedLanguages = canonicalizeAgainstPool(selectedLanguages, availableLanguages);
			selectedCategories = canonicalizeAgainstPool(selectedCategories, availableCategories);
		}
		detailsId = sp.get('details');
		filterPackages();
	};

	const syncUrlFromState = async (opts?: { includeQuery?: boolean }) => {
		const includeQuery = opts?.includeQuery ?? true;
		const next = getCurrentSearchParams();

		if (includeQuery) {
			if (query.trim()) next.set('q', query.trim());
			else next.delete('q');
		}

		next.delete('lang');
		for (const l of selectedLanguages) next.append('lang', l);

		next.delete('cat');
		for (const c of selectedCategories) next.append('cat', c);

		applySearchParams(next, 'push');
	};

	$: if (getCurrentSearch() !== lastUrlSearch) {
		lastUrlSearch = getCurrentSearch();
		if (suppressNextUrlToStateSync) suppressNextUrlToStateSync = false;
		else syncStateFromUrl();
	}
	$: filterPackages();
	const onSearchSubmit = async () => {
		// Ensure UI updates immediately (even if URL update is async/ignored).
		filterPackages();
		await syncUrlFromState({ includeQuery: true });
	};

	const addLanguage = (value: string) => {
		const v = value.trim();
		if (!v) return;
		const canon = availableLanguages.find((p) => p.toLowerCase() === v.toLowerCase()) ?? v;
		if (selectedLanguages.some((x) => x.toLowerCase() === canon.toLowerCase())) return;
		selectedLanguages = dedupeInsensitiveSorted([...selectedLanguages, canon]);
		languageInput = '';
		filterPackages();
		void syncUrlFromState({ includeQuery: false });
	};

	const removeLanguage = (value: string) => {
		const lower = value.toLowerCase();
		selectedLanguages = selectedLanguages.filter((x) => x.toLowerCase() !== lower);
		filterPackages();
		void syncUrlFromState({ includeQuery: false });
	};

	const addCategory = (value: string) => {
		const v = value.trim();
		if (!v) return;
		const canon = availableCategories.find((p) => p.toLowerCase() === v.toLowerCase()) ?? v;
		if (selectedCategories.some((x) => x.toLowerCase() === canon.toLowerCase())) return;
		selectedCategories = dedupeInsensitiveSorted([...selectedCategories, canon]);
		categoryInput = '';
		filterPackages();
		void syncUrlFromState({ includeQuery: false });
	};

	const removeCategory = (value: string) => {
		const lower = value.toLowerCase();
		selectedCategories = selectedCategories.filter((x) => x.toLowerCase() !== lower);
		filterPackages();
		void syncUrlFromState({ includeQuery: false });
	};

	onMount(async () => {
		const res = await fetch('/nvpm-registry.json');
		const data = await res.json();
		const sortedData = data.sort((a: Package, b: Package) => {
			if (a.name < b.name) {
				return -1;
			}
			if (a.name > b.name) {
				return 1;
			}
			return 0;
		});
		packages = sortedData;
		const langPool = uniqSorted(sortedData.flatMap((p: Package) => p.languages ?? []));
		const catPool = uniqSorted(sortedData.flatMap((p: Package) => p.categories ?? []));
		selectedLanguages = canonicalizeAgainstPool(selectedLanguages, langPool);
		selectedCategories = canonicalizeAgainstPool(selectedCategories, catPool);
		filterPackages();
	});

	$: {
		// Keep modal in sync with deep-link param (back/forward friendly).
		const pkgId = detailsId;
		if (!modalInfo || packages.length === 0) {
			// not ready yet
		} else if (!pkgId && modalInfo.open) {
			modalInfo.close();
		} else if (pkgId && (!modalInfo.open || activePackageData.source.id !== pkgId)) {
			openDetails(pkgId);
		}
	}
</script>

<Head
	data={{
		title: 'NVPM Registry: List',
		description: 'Here you can search for packages in the NVPM registry.'
	}}
/>

<dialog bind:this={modalInfo} class="modal" on:cancel={onModalCancel}>
	<div class="modal-box max-h-[90vh] max-w-3xl overflow-y-auto">
		<h3 class="text-lg font-bold">Info</h3>
		{#if showCopySuccess}
			<div role="alert" class="alert alert-success mt-3">
				<span class="icon">
					<i class="fa-solid fa-check"></i>
				</span>
				<span>{copySuccessMessage}</span>
			</div>
		{/if}
		<table class="table w-full">
			<tbody>
				<tr>
					<td>Name:</td>
					<td>
						<div class="flex items-center gap-2">
							<label class="input input-bordered">
								<input type="text" class="grow" readonly value={activePackageData.name} />
							</label>
							<button
								class="btn btn-primary"
								aria-label="Click to copy the name to clipboard"
								on:click={onAttrCopyClick}
								data-copy-value={activePackageData.name}
							>
								<span class="icon">
									<i class="fa-solid fa-copy"></i>
								</span>
							</button>
						</div>
					</td>
				</tr>
				<tr>
					<td>Source ID:</td>
					<td>
						<div class="flex items-center gap-2">
							<label class="input input-bordered">
								<input type="text" class="grow" readonly value={activePackageData.source.id} />
							</label>
							<button
								class="btn btn-primary"
								aria-label="Click to copy the source id to clipboard"
								on:click={onAttrCopyClick}
								data-copy-value={activePackageData.source.id}
							>
								<span class="icon">
									<i class="fa-solid fa-copy"></i>
								</span>
							</button>
						</div>
					</td>
				</tr>
				<tr>
					<td>
						{#if activePackageData.treesitter}
							Integration:
						{:else}
							Install:
						{/if}
					</td>
					<td>
						<div class="flex items-center gap-2">
							{#if activePackageData.treesitter}
								<select class="select ml-2" on:change={onChangeTreesitterIntegration}>
									<option value="none">Create build artifacts</option>
									<option value="neovim" selected>Integrate into Neovim</option>
								</select>
							{/if}
							<label class="input input-bordered">
								<input type="text" class="grow" readonly value={activePackageDataInstallCommand} />
							</label>
							<button
								class="btn btn-primary"
								aria-label="Click to copy the install command to clipboard"
								on:click={onAttrCopyClick}
								data-copy-value={activePackageDataInstallCommand}
							>
								<span class="icon">
									<i class="fa-solid fa-copy"></i>
								</span>
							</button>
						</div>
					</td>
				</tr>
				<tr>
					<td>Description:</td>
					<td>{activePackageData.description}</td>
				</tr>
				<tr>
					<td>Version:</td>
					<td>
						<div class="flex items-center gap-2">
							<label class="input input-bordered w-full">
								<input type="text" class="grow" readonly value={activePackageData.version} />
							</label>
							<button
								class="btn btn-primary"
								aria-label="Click to copy the version to clipboard"
								on:click={onAttrCopyClick}
								data-copy-value={activePackageData.version}
							>
								<span class="icon">
									<i class="fa-solid fa-copy"></i>
								</span>
							</button>
						</div>
					</td>
				</tr>
				<tr>
					<td>Homepage:</td>
					<td>
						<div class="flex items-center gap-2">
							<label class="input input-bordered">
								<input type="text" class="grow" readonly value={activePackageData.homepage} />
							</label>
							<button
								class="btn btn-primary"
								aria-label="Click to open the homepage in a new tab"
								on:click={onHomepageIconClick}
								data-homepage={activePackageData.homepage}
							>
								<span class="icon">
									<i class="fa-solid fa-external-link"></i>
								</span>
							</button>
						</div>
					</td>
				</tr>
				<tr>
					<td>Licenses:</td>
					<td>{activePackageData.licenses.join(', ')}</td>
				</tr>
				{#if activePackageData.languages}
					<tr>
						<td>Languages:</td>
						<td>{activePackageData.languages.join(', ')}</td>
					</tr>
				{/if}
				{#if activePackageData.tags}
					<tr>
						<td>Tags:</td>
						<td>{activePackageData.tags.join(', ')}</td>
					</tr>
				{/if}
				<tr>
					<td>Categories:</td>
					<td>{activePackageData.categories.join(', ')}</td>
				</tr>
				{#if activePackageData.aliases?.length}
					<tr>
						<td>Aliases:</td>
						<td>{activePackageData.aliases.join(', ')}</td>
					</tr>
				{/if}
				<PackageInfoExtra pkg={activePackageData} onNavigatePackage={navigateToPackageDetails} />
			</tbody>
		</table>
		<div class="modal-action">
			<button bind:this={modalInfoCloseButton} class="btn" on:click={closeDetails}>Close</button>
		</div>
	</div>
</dialog>

<fieldset class="fieldset bg-base-200 border-base-300 rounded-box mb-4 border p-4">
	<legend class="fieldset-legend">Search</legend>

	<form on:submit|preventDefault={onSearchSubmit}>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<label class="form-control">
				<div class="label"><span class="label-text">Query</span></div>
				<div class="join w-full">
					<input
						class="input input-bordered join-item w-full"
						type="text"
						placeholder="Name or alias"
						bind:value={query}
					/>
					<button class="btn btn-primary join-item" type="submit">Search</button>
				</div>
			</label>

			<TagFilter
				label="Languages"
				badgeClass="badge-secondary"
				btnClass="btn-secondary"
				selected={selectedLanguages}
				suggestions={availableLanguages}
				bind:inputValue={languageInput}
				inputPlaceholder="Type a language"
				showAllOptions={false}
				minCharsToShowOptions={2}
				onAdd={addLanguage}
				onRemove={removeLanguage}
			/>

			<TagFilter
				label="Categories"
				badgeClass="badge-accent"
				btnClass="btn-accent"
				selected={selectedCategories}
				suggestions={availableCategories}
				bind:inputValue={categoryInput}
				inputPlaceholder="Type a category"
				showAllOptions={true}
				minCharsToShowOptions={0}
				onAdd={addCategory}
				onRemove={removeCategory}
			/>
		</div>
	</form>
</fieldset>

<div class="overflow-x-auto">
	<table class="table w-full">
		<thead>
			<tr>
				<th>Name</th>
				<th>Version</th>
				{#if query.trim() !== '' && filteredPackages.length > 0}
					<th>Search Info</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{#each filteredPackages as pkg, i (pkg.source.id)}
				<tr
					class="remote-package-item {i === activePackageIndex
						? 'bg-primary text-primary-content'
						: ''}"
					on:click={onRemotePackageItemClick}
					data-index={i}
					data-package-id={pkg.source.id}
				>
					<td>{pkg.name}</td>
					<td>
						<span title={pkg.version}>{truncateVersion(pkg.version)}</span>
					</td>
					{#if query.trim() !== '' && filteredPackages.length > 0}
						<td>
							<span>{pkg.searchMatchInfo}</span>
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	td {
		vertical-align: top;
	}
</style>
