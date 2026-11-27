'use strict';
'require baseclass';
'require ui';

/* Sidebar for the Roam theme: simple pages first (admin/roam/*), then every other
   LuCI menu (Status, System, Services, Network, VPN, ...) under "Advanced Settings". */

const ICONS = {
	dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
	internet: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
	wireless: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01',
	clients: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
	vpn: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
	network: 'M9 2h6v6H9zM2 16h6v6H2zM16 16h6v6h-6zM12 8v4M5 16v-4h14v4',
	system: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
	apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
	update: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5',
	advanced: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
	chevron: 'M6 9l6 6 6-6',
	mode_auto: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 2v20',
	mode_dark: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
	mode_light: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42'
};
const MODES = [ [ 'auto', 'Auto' ], [ 'dark', 'Dark' ], [ 'light', 'Light' ] ];

function icon(name, size) {
	const s = size || 20;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', s);
	svg.setAttribute('height', s);
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	p.setAttribute('d', ICONS[name] || ICONS.advanced);
	svg.appendChild(p);
	return svg;
}

const SKIP = { roam: true, logout: true, uci: true, menu: true, translations: true };

return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => this.render(tree));

		const burger = document.getElementById('roam-burger');
		const scrim = document.getElementById('roam-scrim');
		if (burger)
			burger.addEventListener('click', () => document.body.classList.toggle('roam-nav-open'));
		if (scrim)
			scrim.addEventListener('click', () => document.body.classList.remove('roam-nav-open'));

		/* Appearance button: Auto -> Dark -> Light */
		const mode = document.getElementById('roam-mode');
		if (mode && window.roamTheme) {
			const draw = () => {
				const cur = window.roamTheme();
				const m = MODES.filter((x) => x[0] == cur)[0] || MODES[0];
				mode.replaceChildren(icon('mode_' + m[0], 18), E('span', {}, [ _(m[1]) ]));
				mode.title = _('Appearance: %s (click to change)').format(_(m[1]));
			};
			mode.addEventListener('click', () => {
				const i = MODES.findIndex((x) => x[0] == window.roamTheme());
				window.roamTheme(MODES[(i + 1) % MODES.length][0]);
				draw();
			});
			draw();
		}
	},

	render(tree) {
		const path = L.env.dispatchpath || [];
		const admin = tree.children && tree.children.admin;
		const nav = document.getElementById('roam-nav');

		if (!admin || !nav)
			return;

		/* Simple pages */
		const roam = admin.children && admin.children.roam;
		if (roam) {
			ui.menu.getChildren(roam).forEach((child) => {
				const active = (path[1] == 'roam' && path[2] == child.name);
				nav.appendChild(E('a', {
					'href': L.url('admin', 'roam', child.name),
					'class': active ? 'active' : ''
				}, [ icon(child.name), E('span', {}, [ _(child.title) ]) ]));
			});
		}

		/* Everything else = full OpenWrt LuCI */
		const inAdvanced = (path[0] == 'admin' && path[1] && path[1] != 'roam');
		let stored = null;
		try { stored = window.localStorage.getItem('roam-adv'); } catch (e) {}
		const collapsed = inAdvanced ? false : (stored !== 'open');

		const list = E('div', { 'class': 'roam-adv-list' });
		const group = E('div', { 'class': 'roam-adv' + (collapsed ? ' collapsed' : '') }, [
			E('div', { 'class': 'roam-nav-sep' }, [ E('span', {}, [ _('Advanced Settings') ]), icon('chevron', 14) ]),
			list
		]);

		group.firstElementChild.addEventListener('click', () => {
			group.classList.toggle('collapsed');
			try { window.localStorage.setItem('roam-adv', group.classList.contains('collapsed') ? 'closed' : 'open'); } catch (e) {}
		});

		ui.menu.getChildren(admin).forEach((top) => {
			if (SKIP[top.name])
				return;

			const subs = ui.menu.getChildren(top);
			const open = (path[1] == top.name);
			const sub = E('div', { 'class': 'roam-adv-sub' });

			subs.forEach((s) => {
				sub.appendChild(E('a', {
					'href': L.url('admin', top.name, s.name),
					'class': (open && path[2] == s.name) ? 'active' : ''
				}, [ _(s.title) ]));
			});

			const head = E('a', {
				'href': subs.length ? '#' : L.url('admin', top.name),
				'class': open ? 'active' : ''
			}, [ icon('advanced', 16), E('span', {}, [ _(top.title) ]) ]);

			const g = E('div', { 'class': 'roam-adv-group' + (open ? ' open' : '') }, [ head, sub ]);

			if (subs.length)
				head.addEventListener('click', (ev) => { ev.preventDefault(); g.classList.toggle('open'); });

			list.appendChild(g);
		});

		if (list.children.length)
			nav.appendChild(group);

		/* Page title + LuCI's sub-page tabs (used by the advanced pages) */
		let node = admin, url = 'admin', crumbs = [];
		for (let i = 1; i < 3 && node && path[i]; i++) {
			node = node.children ? node.children[path[i]] : null;
			url += '/' + path[i];
			if (node && node.title)
				crumbs.push(_(node.title));
		}

		const title = document.getElementById('roam-title');
		if (title && crumbs.length)
			title.textContent = (path[1] == 'roam') ? crumbs[crumbs.length - 1] : crumbs.join(' › ');

		if (node && path[1] != 'roam')
			this.renderTabMenu(node, url);
	},

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		children.forEach((child) => {
			const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
			ul.appendChild(E('li', { 'class': 'tabmenu-item-%s %s'.format(child.name, isActive ? 'active' : '') }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));
			if (isActive)
				activeNode = child;
		});

		if (ul.children.length == 0)
			return E([]);

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

		return ul;
	}
});
