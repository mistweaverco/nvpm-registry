<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';

	let currentRoute = page.url.pathname;

	afterNavigate(() => {
		currentRoute = page.url.pathname;
	});
</script>

<div class="navbar bg-base-300 sticky top-0 z-10">
	<div class="flex-1">
		<a href="/">
			<button class="btn {currentRoute === '/' ? 'btn-primary' : ''}">
				<span class="icon">
					<i class="fa-solid fa-house"></i>
				</span>
				<strong>Home</strong>
			</button>
		</a>
		<a href="/list">
			<div class="indicator">
				<button class="btn {currentRoute === '/list' ? 'btn-primary' : ''}">
					<span class="icon">
						<i class="fa-solid fa-cloud"></i>
					</span>
					<strong>Registry</strong>
				</button>
			</div>
		</a>
		<a href="https://github.com/mistweaverco/nvpm-registry" target="_blank">
			<button class="btn">
				<span class="icon">
					<i class="fa-brands fa-github"></i>
				</span>
				<strong>Github</strong>
			</button>
		</a>
	</div>
</div>
