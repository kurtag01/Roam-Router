'use strict';
'require view';
'require uci';
'require rpc';
'require ui';
'require fs';
'require roam.common as rc';

/* Security: threat and country blocking with banIP. Roam's glue (interfaces, status,
   recent blocks): /usr/libexec/roam/banip. Everything else: Advanced › banIP. */

const HELPER = '/usr/libexec/roam/banip';
const callUciCommit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ] });
const callHostHints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { '': {} } });

const STANDARD = [ 'spamhaus', 'feodo', 'hagezi', 'threatview' ];
const STRICT = STANDARD.concat([ 'threat', 'webclient', 'etcompromised', 'cinsscore', 'ipsum', 'debl', 'greensnow' ]);
const LIST_NAMES = {
	spamhaus: 'Spamhaus DROP', feodo: 'Feodo Tracker (botnets)', hagezi: 'HaGeZi threats', threatview: 'ThreatView',
	threat: 'Emerging Threats', webclient: 'malware servers', etcompromised: 'compromised hosts', cinsscore: 'CINS Score',
	ipsum: 'IPsum', debl: 'blocklist.de', greensnow: 'GreenSnow', country: 'country block', blocklist: 'your blocklist'
};

function feeds() { return L.toArray(uci.get('banip', 'global', 'ban_feed')); }
function same(a, b) { return a.length == b.length && a.every((x) => b.indexOf(x) >= 0); }
function threatFeeds() { return feeds().filter((f) => f != 'country'); }
function level() {
	const t = threatFeeds();
	return same(t, STANDARD) ? 'standard' : same(t, STRICT) ? 'strict' : 'custom';
}

function parseLines(r) {
	return String((r && r.stdout) || '').split('\n').filter((l) => l).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((x) => x);
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('banip').catch(() => null),
			L.resolveDefault(fs.exec(HELPER, [ 'status' ]), {}),
			L.resolveDefault(fs.read('/etc/banip/banip.countries'), ''),
			L.resolveDefault(fs.exec(HELPER, [ 'recent' ]), {}),
			L.resolveDefault(callHostHints(), {})
		]);
	},

	statusOf(r) {
		try { return JSON.parse((r && r.stdout) || '{}'); } catch (e) { return {}; }
	},

	save() {
		const on = this.sw.checked;
		const lv = this.level;
		let list = lv == 'standard' ? STANDARD.slice() : lv == 'strict' ? STRICT.slice() : threatFeeds();
		if (this.countries.length) list.push('country');
		uci.set('banip', 'global', 'ban_enabled', on ? '1' : '0');
		uci.set('banip', 'global', 'ban_feed', list);
		if (this.countries.length) uci.set('banip', 'global', 'ban_country', this.countries.slice());
		else uci.unset('banip', 'global', 'ban_country');
		const inout = L.toArray(uci.get('banip', 'global', 'ban_feedinout'));
		if (inout.indexOf('country') < 0) uci.set('banip', 'global', 'ban_feedinout', inout.concat([ 'country' ]));
		return uci.save().then(() => callUciCommit('banip')).then(() => fs.exec(HELPER, [ 'apply' ])).then((r) => {
			if (r.code != 0) throw new Error(r.stderr || 'banIP could not be started');
			rc.note(on ? 'Saved. The block lists are being downloaded; this takes a few seconds.' : 'Threat blocking is off.', 'info');
			return this.poll(on ? 12 : 1);
		}).catch((e) => rc.note('Saving failed: ' + ((e && e.message) || e), 'danger'));
	},

	/* Refresh the status card until banIP reports a final state. */
	poll(tries) {
		return fs.exec(HELPER, [ 'status' ]).then((r) => {
			const st = this.statusOf(r);
			this.statusBox.replaceChildren(this.statusBody(st));
			this.setPill(st);
			if (tries > 1 && st.state != 'active' && st.state != 'off' && st.state != 'error')
				return new Promise((res) => window.setTimeout(res, 2500)).then(() => this.poll(tries - 1));
		});
	},

	setPill(st) {
		const p = this.pill;
		if (!p) return;
		const m = { active: [ 'Protecting', 'ok' ], off: [ 'Off', '' ], error: [ 'Problem', 'bad' ] }[st.state] || [ 'Starting', 'warn' ];
		p.textContent = m[0]; p.className = 'roam-pill ' + m[1];
	},

	statusBody(st) {
		if (st.state == 'off') return E('p', { 'class': 'roam-muted roam-small' }, [ 'Off: devices can reach any address.' ]);
		if (st.state == 'error') return E('p', { 'class': 'roam-small roam-drop-err' }, [ 'banIP stopped with an error. Click Save to start it again, or see Advanced › banIP › Log.' ]);
		if (st.state != 'active') return E('p', { 'class': 'roam-muted roam-small spinning' }, [ 'Downloading the block lists…' ]);
		const n = (x) => (+x || 0).toLocaleString();
		return rc.kv([
			[ 'Blocked addresses', n(st.addresses) ],
			[ 'Lists updated', st.updated || null ],
			[ 'Blocked since start', n(st.blocked_out) + ' outgoing · ' + n(st.blocked_in) + ' incoming' ]
		]);
	},

	threatCard(st) {
		this.level = level();
		this.sw = E('input', { 'type': 'checkbox', 'role': 'switch', 'checked': uci.get('banip', 'global', 'ban_enabled') == '1' ? '' : null });
		const desc = E('p', { 'class': 'roam-muted roam-small' });
		const seg = E('div', { 'class': 'roam-seg' });
		const opts = [ [ 'standard', 'Standard' ], [ 'strict', 'Strict' ] ].concat(this.level == 'custom' ? [ [ 'custom', 'Custom' ] ] : []);
		const btns = {};
		const refresh = () => {
			for (const k in btns) btns[k].classList.toggle('active', k == this.level);
			desc.textContent = {
				standard: 'Blocks botnet command servers, hijacked networks and known malware hosts (Spamhaus DROP, Feodo Tracker, HaGeZi, ThreatView). Very few false alarms. Recommended.',
				strict: 'Standard plus lists of attacking and suspicious hosts (Emerging Threats, CINS, IPsum, blocklist.de, GreenSnow and more). Blocks more, but a rarely used website may occasionally be caught.',
				custom: 'Lists chosen under Advanced › banIP. Choose Standard or Strict to go back to Roam\'s selection.'
			}[this.level];
		};
		opts.forEach((o) => { btns[o[0]] = E('button', { 'type': 'button', 'click': () => { this.level = o[0]; refresh(); } }, [ o[1] ]); seg.appendChild(btns[o[0]]); });
		refresh();
		this.statusBox = E('div', {}, [ this.statusBody(st) ]);
		const card = rc.card({ icon: 'shield', title: 'Threat blocking', pill: '…', body: [
			E('p', { 'class': 'roam-muted', 'style': 'margin-top:0' }, [ 'Stops every device on your Wi-Fi from connecting to known botnet, malware and attacker addresses, even when the VPN is on. The lists update daily.' ]),
			E('label', { 'class': 'roam-switch' }, [ this.sw, E('span', { 'class': 'roam-switch-track', 'aria-hidden': 'true' }), E('span', {}, [ 'Block known threats' ]) ]),
			E('div', { 'class': 'roam-field-label', 'style': 'margin-top:12px' }, [ 'Protection level' ]), seg, desc,
			this.statusBox
		], actions: [
			E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, 'save') }, [ 'Save' ]),
			E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, () => fs.exec(HELPER, [ 'refresh' ]).then(() => { rc.note('Updating the block lists…', 'info'); return this.poll(12); })) }, [ 'Update lists now' ]),
			E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/services/banip') }, [ 'Advanced' ])
		] });
		this.pill = card.querySelector('.roam-pill');
		this.setPill(st);
		return card;
	},

	countryCard(text) {
		const all = String(text || '').split('\n').map((l) => l.split('\t')).filter((c) => c.length >= 3 && /^[a-z]{2}$/.test(c[0]))
			.map((c) => ({ code: c[0], name: c[2] })).sort((a, b) => a.name.localeCompare(b.name));
		const nameOf = (code) => (all.filter((c) => c.code == code)[0] || { name: code.toUpperCase() }).name;
		this.countries = L.toArray(uci.get('banip', 'global', 'ban_country'));
		const chips = E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:6px;margin:10px 0' });
		const sel = E('select', { 'aria-label': 'Add a country' });
		const draw = () => {
			chips.replaceChildren(...(this.countries.length ? this.countries.map((c) => E('span', { 'class': 'roam-pill', 'style': 'display:inline-flex;align-items:center;gap:6px' }, [
				nameOf(c), E('button', { 'type': 'button', 'title': 'Remove', 'aria-label': 'Remove ' + nameOf(c), 'style': 'border:0;background:none;cursor:pointer;padding:0;font-size:15px;line-height:1;color:inherit',
					'click': () => { this.countries = this.countries.filter((x) => x != c); draw(); } }, [ '×' ]) ]))
				: [ E('span', { 'class': 'roam-muted roam-small' }, [ 'No countries blocked.' ]) ]));
			sel.replaceChildren(E('option', { 'value': '' }, [ 'Add a country…' ]),
				...all.filter((c) => this.countries.indexOf(c.code) < 0).map((c) => E('option', { 'value': c.code }, [ c.name ])));
		};
		sel.addEventListener('change', () => { if (sel.value) { this.countries.push(sel.value); draw(); } });
		draw();
		return rc.card({ icon: 'globe', title: 'Country blocking', pill: this.countries.length ? this.countries.length + ' blocked' : 'None', pillClass: this.countries.length ? 'ok' : '', body: [
			E('p', { 'class': 'roam-muted', 'style': 'margin-top:0' }, [ 'Blocks all connections to and from the chosen countries. Uses the threat-blocking switch above.' ]),
			chips, sel,
			E('p', { 'class': 'roam-muted roam-small', 'style': 'margin-top:10px' }, [ 'Don\'t block the country you are in, your home network\'s country or your VPN server\'s. Large websites use servers in many countries, so some may stop working.' ])
		], actions: [ E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, 'save') }, [ 'Save' ]) ] });
	},

	recentCard(rows, hints) {
		const who = (r) => {
			const h = (r.mac && hints[r.mac.toUpperCase()]) || Object.keys(hints).map((k) => hints[k]).filter((x) => L.toArray(x.ipaddrs).indexOf(r.src) >= 0)[0];
			return (h && h.name) || r.src;
		};
		const list = E('ul', { 'class': 'roam-list' }, rows.length ? rows.slice(0, 15).map((r) => E('li', {}, [
			E('div', { 'class': 'grow' }, [
				E('strong', {}, [ who(r) + ' → ' + r.dst + (r.port ? ':' + r.port : '') ]),
				E('span', { 'class': 'roam-small roam-muted' }, [ r.time + ' · ' + (LIST_NAMES[r.list.replace(/\.v[46](MAC)?$/, '')] || r.list) ])
			]),
			E('button', { 'class': 'btn cbi-button', 'title': 'Never block ' + r.dst, 'click': ui.createHandlerFn(this, () => {
				if (!confirm('Allow ' + r.dst + '? Only do this if you are sure it is safe (for example a website you trust stopped working).')) return;
				return fs.exec(HELPER, [ 'allow', r.dst ]).then((x) => rc.note(x.code == 0 ? r.dst + ' is allowed now.' : (x.stderr || 'Failed.'), x.code == 0 ? 'info' : 'danger'));
			}) }, [ 'Allow' ])
		])) : [ E('li', { 'class': 'roam-muted' }, [ 'Nothing blocked yet.' ]) ]);
		return rc.card({ icon: 'clock', title: 'Recently blocked', body: [
			E('p', { 'class': 'roam-muted roam-small', 'style': 'margin-top:0' }, [ 'Connections from your devices that were stopped. Turn on "Blocked threats" under Notifications to hear about them on your phone.' ]),
			list
		], actions: [ E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/roam/notify') }, [ 'Notifications' ]) ] });
	},

	render(data) {
		if (!uci.get('banip', 'global'))
			return E('div', {}, [ E('p', { 'class': 'roam-intro' }, [ 'banIP is not installed on this router.' ]) ]);
		const st = this.statusOf(data[1]);
		const node = E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Protection for the devices on your network.' ]),
			E('div', { 'class': 'roam-grid' }, [ this.threatCard(st), this.countryCard(data[2]), this.recentCard(parseLines(data[3]), data[4] || {}) ])
		]);
		if (st.state && st.state != 'active' && st.state != 'off' && st.state != 'error') this.poll(12);
		return node;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
