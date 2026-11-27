'use strict';
'require baseclass';
'require ui';
'require uci';
'require fs';

/* Shared helpers for the Roam pages. */

const ICONS = {
	globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
	wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01',
	repeater: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M12 2v5M9 4l3-2 3 2',
	ethernet: 'M4 6h16v10H4zM8 16v3M16 16v3M12 16v3M7 9h2M11 9h2M15 9h2',
	phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
	users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
	shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
	cpu: 'M6 6h12v12H6zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3',
	guest: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
	radio: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14',
	lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
	network: 'M9 2h6v6H9zM2 16h6v6H2zM16 16h6v6h-6zM12 8v4M5 16v-4h14v4',
	gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
	update: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5',
	games: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.59L2 15a3 3 0 0 0 5.2 2.1L9 15h6l1.8 2.1A3 3 0 0 0 22 15l-.7-6.41A4 4 0 0 0 17.32 5z',
	plex: 'M5 3l14 9-14 9V3z',
	clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2'
};

return baseclass.extend({
	icon(name, size) {
		const s = size || 22;
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', s); svg.setAttribute('height', s);
		svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
		const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		p.setAttribute('d', ICONS[name] || ICONS.gear);
		svg.appendChild(p);
		return svg;
	},

	/* card({icon, title, pill, pillClass, off, body:[], actions:[]}) */
	card(o) {
		return E('div', { 'class': 'roam-card' + (o.cls ? ' ' + o.cls : '') }, [
			E('div', { 'class': 'roam-card-head' }, [
				E('div', { 'class': 'roam-ico' + (o.off ? ' off' : '') }, [ this.icon(o.icon) ]),
				E('h3', {}, [ o.title ]),
				o.pill ? E('span', { 'class': 'roam-pill ' + (o.pillClass || '') }, [ o.pill ]) : ''
			]),
			E('div', { 'class': 'roam-card-body' }, o.body || []),
			(o.actions && o.actions.length) ? E('div', { 'class': 'roam-actions' }, o.actions) : ''
		]);
	},

	kv(pairs) {
		const dl = E('dl', { 'class': 'roam-kv' });
		pairs.forEach((p) => {
			if (p == null || p[1] == null || p[1] === '')
				return;
			dl.appendChild(E('dt', {}, [ p[0] ]));
			dl.appendChild(E('dd', {}, [ p[1] ]));
		});
		return dl;
	},

	signal(dbm) {
		const q = (dbm == null || dbm == 0) ? 0 : (dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : 1);
		const bars = E('span', { 'class': 'roam-signal', 'title': dbm ? dbm + ' dBm' : '' });
		for (let i = 1; i <= 4; i++)
			bars.appendChild(E('i', { 'class': i <= q ? 'on' : '', 'style': 'height:' + (4 * i) + 'px' }));
		return bars;
	},

	bytes(n) {
		n = +n || 0;
		const u = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
		let i = 0;
		while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
		return (i ? n.toFixed(1) : n) + ' ' + u[i];
	},

	duration(s) {
		s = +s || 0;
		const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
		return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm';
	},

	/* Locally administered, unicast MAC (first byte: x2, x6, xA or xE). */
	randomMac() {
		const b = new Uint8Array(6);
		window.crypto.getRandomValues(b);
		b[0] = (b[0] & 0xfc) | 0x02;
		return Array.from(b).map((x) => ('0' + x.toString(16)).slice(-2)).join(':');
	},

	isMac(s) {
		return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(s || '') && !/^(00:){5}00$/.test(s) && !(parseInt(s.substr(0, 2), 16) & 1);
	},

	/* MAC editor. value: '' = factory, 'random' = new random MAC each time it starts,
	   otherwise a fixed MAC. clones: [{mac, label}] offered as "copy from device". */
	macEditor(value, factoryMac, clones) {
		const self = this;
		let mode = !value ? 'factory' : (value == 'random' ? 'random' : 'custom');
		const input = E('input', { 'type': 'text', 'class': 'roam-mono', 'placeholder': 'aa:bb:cc:dd:ee:ff',
			'value': (mode == 'custom') ? value : '' });
		const gen = E('button', { 'class': 'btn cbi-button', 'type': 'button', 'click': () => { input.value = self.randomMac(); } }, [ 'Generate' ]);
		const clone = (clones && clones.length) ? E('select', { 'change': (ev) => { if (ev.target.value) input.value = ev.target.value; ev.target.selectedIndex = 0; } },
			[ E('option', { 'value': '' }, [ 'Copy from device…' ]) ].concat(clones.map((c) => E('option', { 'value': c.mac }, [ c.label + ' (' + c.mac + ')' ])))) : '';
		const custom = E('div', { 'class': 'roam-mac' }, [ input, gen, clone ]);
		const hint = E('div', { 'class': 'roam-muted roam-small', 'style': 'margin-top:6px' });

		const seg = E('div', { 'class': 'roam-seg' });
		const modes = [ [ 'factory', 'Factory' ], [ 'random', 'Random' ], [ 'custom', 'Custom' ] ];
		const btns = {};

		function refresh() {
			for (const k in btns) btns[k].classList.toggle('active', k == mode);
			custom.style.display = (mode == 'custom') ? '' : 'none';
			hint.textContent = (mode == 'factory') ? ('Uses the adapter\'s built-in address' + (factoryMac ? ' (' + factoryMac + ').' : '.'))
				: (mode == 'random') ? 'A new random address is used every time Wi-Fi starts (privacy).'
				: 'Always uses the address entered here.';
		}
		modes.forEach((m) => {
			btns[m[0]] = E('button', { 'type': 'button', 'click': () => { mode = m[0]; if (mode == 'custom' && !input.value) input.value = self.randomMac(); refresh(); } }, [ m[1] ]);
			seg.appendChild(btns[m[0]]);
		});
		refresh();

		return {
			node: E('div', {}, [ seg, E('div', { 'style': 'margin-top:10px' }, [ custom ]), hint ]),
			getValue() {
				if (mode == 'factory') return '';
				if (mode == 'random') return 'random';
				const v = input.value.trim().toLowerCase().replace(/-/g, ':');
				if (!self.isMac(v))
					throw new Error('"' + input.value + '" is not a valid unicast MAC address (example: 02:1a:2b:3c:4d:5e).');
				return v;
			}
		};
	},

	/* Save staged UCI changes and apply them (with LuCI's automatic rollback if
	   the router becomes unreachable). */
	apply() {
		return uci.save().then(() => ui.changes.apply(true));
	},

	/* Apply a MAC change: schedule a restart of the radio once the new value is
	   committed (hostapd's in-place reload keeps the old address), then apply. */
	applyMac(sid, value) {
		return fs.exec('/usr/libexec/roam/mac-apply', [ sid, value || '' ]).catch(() => null).then(() => this.apply());
	},

	note(msg, type) {
		ui.addNotification(null, E('p', {}, [ msg ]), type || 'info');
	}
});
