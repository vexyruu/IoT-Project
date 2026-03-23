import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			fallback: 'index.html' // SPA mode — needed for Vercel/Cloudflare Pages
		})
	}
};

export default config;
