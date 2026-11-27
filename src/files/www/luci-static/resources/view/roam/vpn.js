'use strict';
'require view';
'require network';
'require rpc';
'require uci';
'require ui';
'require poll';
'require fs';
'require roam.common as rc';

/* WireGuard client: import a provider's .conf file, switch it on/off, show status.
   Everything else (OpenVPN, WireGuard server, policy routing) is under Advanced. */

const callWg = rpc.declare({ object: 'luci.wireguard', method: 'getWgInstances', expect: { '': {} } });
const IFACE = 'wgclient', PEER = 'wgclient_peer';

function parseConf(text) {
	const out = { iface: {}, peers: [] };
	let cur = null;
	text.split(/\r?\n/).forEach((line) => {
		line = line.replace(/#.*$/, '').trim();
		if (!line) return;
		const sec = line.match(/^\[(\w+)\]$/);
		if (sec) {
			cur = sec[1].toLowerCase() == 'peer' ? {} : out.iface;
			if (sec[1].toLowerCase() == 'peer') out.peers.push(cur);
			return;
		}
		const kv = line.match(/^([A-Za-z]+)\s*=\s*(.+)$/);
		if (kv && cur) cur[kv[1].toLowerCase()] = kv[2].trim();
	});
	return out;
}
function list(v) { return (v || '').split(/\s*,\s*/).filter(Boolean); }
const KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

/* Reuse an existing section (clearing its options) instead of delete + re-add,
   which LuCI would send in one batch. */
function fresh(conf, type, name) {
	const cur = uci.get(conf, name);
	if (cur && cur['.type'] == type) {
		Object.keys(cur).forEach((k) => { if (k.charAt(0) != '.') uci.unset(conf, name, k); });
		return name;
	}
	if (cur) uci.remove(conf, name);
	return uci.add(conf, type, name);
}

function wanZone() {
	return uci.sections('firewall', 'zone').filter((z) => z.name == 'wan')[0];
}

return view.extend({
	load() {
		return Promise.all([
			uci.load([ 'network', 'firewall', 'roam' ]),
			network.getNetworks(),
			L.resolveDefault(callWg(), {})
		]);
	},

	/* -> null if the configuration can be imported, else what is wrong with it. */
	check(text) {
		if (/^\s*(client|remote|dev\s+tun|<ca>)\b/m.test(text) && !/\[Interface\]/i.test(text))
			return 'This looks like an OpenVPN profile (.ovpn). This page takes WireGuard configurations; OpenVPN profiles go under "More VPN options" → OpenVPN.';
		const c = parseConf(text), i = c.iface, p = c.peers[0];
		if (!i.privatekey || !KEY.test(i.privatekey)) return 'There is no valid private key (PrivateKey in the [Interface] section).';
		if (!i.address) return 'There is no tunnel address (Address in the [Interface] section).';
		if (!p || !p.publickey || !KEY.test(p.publickey)) return 'There is no valid server public key (PublicKey in the [Peer] section).';
		if (p.presharedkey && !KEY.test(p.presharedkey)) return 'The preshared key is not a valid WireGuard key.';
		if (!p.endpoint) return 'There is no server address (Endpoint in the [Peer] section).';
		if (!/^\[?([^\]]+?)\]?:(\d+)$/.test(p.endpoint)) return 'Could not read the server address "' + p.endpoint + '" (expected host:port).';
		return null;
	},

	importConf(text) {
		const m = this.check(text);
		if (m) { rc.note(m, 'warning'); return Promise.resolve(); }
		const c = parseConf(text), i = c.iface, p = c.peers[0];
		if (c.peers.length > 1) rc.note('This file has several peers; only the first one is used.', 'info');
		const ep = p.endpoint.match(/^\[?([^\]]+?)\]?:(\d+)$/);

		/* Split default routes so they win over the uplink's default route
		   (netifd adds a host route to the endpoint via the uplink). */
		let allowed = list(p.allowedips || '0.0.0.0/0, ::/0');
		const split = [];
		allowed.forEach((a) => {
			if (a == '0.0.0.0/0') split.push('0.0.0.0/1', '128.0.0.0/1');
			else if (a == '::/0') split.push('::/1', '8000::/1');
			else split.push(a);
		});

		fresh('network', 'interface', IFACE);
		uci.set('network', IFACE, 'proto', 'wireguard');
		uci.set('network', IFACE, 'private_key', i.privatekey);
		uci.set('network', IFACE, 'addresses', list(i.address));
		const dns = list(i.dns).filter((d) => /^[0-9a-f:.]+$/i.test(d));
		if (dns.length) uci.set('network', IFACE, 'dns', dns);
		if (i.mtu) uci.set('network', IFACE, 'mtu', i.mtu);

		fresh('network', 'wireguard_' + IFACE, PEER);
		uci.set('network', PEER, 'description', 'Imported peer');
		uci.set('network', PEER, 'public_key', p.publickey);
		if (p.presharedkey) uci.set('network', PEER, 'preshared_key', p.presharedkey);
		uci.set('network', PEER, 'endpoint_host', ep[1]);
		uci.set('network', PEER, 'endpoint_port', ep[2]);
		uci.set('network', PEER, 'allowed_ips', split);
		uci.set('network', PEER, 'route_allowed_ips', '1');
		uci.set('network', PEER, 'persistent_keepalive', p.persistentkeepalive || '25');

		const z = wanZone();
		if (z && uci.get('roam', 'main', 'killswitch') != '1') {
			const nets = L.toArray(z.network);
			if (nets.indexOf(IFACE) < 0) { nets.push(IFACE); uci.set('firewall', z['.name'], 'network', nets); }
		}
		return rc.apply();
	},

	/* The current configuration as form values (for "Enter manually" when replacing). */
	currentValues() {
		const g = (s, o) => uci.get('network', s, o);
		let allowed = L.toArray(g(PEER, 'allowed_ips'));
		const has = (a) => allowed.indexOf(a) >= 0;
		if (has('0.0.0.0/1') && has('128.0.0.0/1')) allowed = [ '0.0.0.0/0' ].concat(allowed.filter((a) => a != '0.0.0.0/1' && a != '128.0.0.0/1'));
		if (has('::/1') && has('8000::/1')) allowed = allowed.filter((a) => a != '::/1' && a != '8000::/1').concat([ '::/0' ]);
		return {
			privatekey: g(IFACE, 'private_key') || '', address: L.toArray(g(IFACE, 'addresses')).join(', '),
			dns: L.toArray(g(IFACE, 'dns')).join(', '), mtu: g(IFACE, 'mtu') || '',
			publickey: g(PEER, 'public_key') || '', presharedkey: g(PEER, 'preshared_key') || '',
			host: g(PEER, 'endpoint_host') || '', port: g(PEER, 'endpoint_port') || '51820',
			allowedips: allowed.join(', ') || '0.0.0.0/0, ::/0', keepalive: g(PEER, 'persistent_keepalive') || '25'
		};
	},

	/* file: a File dropped on the WireGuard card (optional). */
	importModal(file) {
		const err = E('div', { 'class': 'roam-drop-err', 'role': 'alert' });
		const showErr = (m) => { err.textContent = m || ''; err.style.display = m ? '' : 'none'; };
		showErr(null);

		/* --- From a file: drop zone, file chooser, paste --- */
		const ta = E('textarea', { 'rows': 9, 'spellcheck': 'false', 'class': 'roam-mono', 'style': 'width:100%;box-sizing:border-box',
			'placeholder': '[Interface]\nPrivateKey = …\nAddress = 10.0.0.2/32\nDNS = 10.0.0.1\n\n[Peer]\nPublicKey = …\nEndpoint = vpn.example.com:51820\nAllowedIPs = 0.0.0.0/0, ::/0',
			'input': () => showErr(null) });
		const loaded = E('span', { 'class': 'roam-drop-sub' }, [ 'or click to choose a file' ]);
		const load = (f) => {
			if (!f) return;
			showErr(null);
			if (f.size > 65536) return showErr('"' + f.name + '" is too large to be a WireGuard configuration.');
			const r = new FileReader();
			r.onload = () => {
				ta.value = String(r.result || '');
				loaded.textContent = 'Loaded "' + f.name + '"; check it below, then import.';
				const m = this.check(ta.value);
				if (m) showErr(m);
			};
			r.onerror = () => showErr('Could not read "' + f.name + '".');
			r.readAsText(f);
		};
		const chooser = E('input', { 'type': 'file', 'accept': '.conf,text/plain', 'style': 'display:none', 'change': (ev) => { load(ev.target.files[0]); ev.target.value = ''; } });
		const zone = E('div', { 'class': 'roam-drop', 'tabindex': '0', 'role': 'button', 'aria-label': 'Drop a WireGuard .conf file here, or press Enter to choose one',
			'click': () => chooser.click(),
			'keydown': (ev) => { if (ev.key == 'Enter' || ev.key == ' ') { ev.preventDefault(); chooser.click(); } },
			'dragover': (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; zone.classList.add('over'); },
			'dragleave': () => zone.classList.remove('over'),
			'drop': (ev) => { ev.preventDefault(); zone.classList.remove('over'); load(ev.dataTransfer.files[0]); }
		}, [ rc.icon('shield', 22), E('strong', {}, [ 'Drop your .conf file here' ]), loaded, chooser ]);
		const filePane = E('div', {}, [
			zone,
			E('label', { 'class': 'roam-field-label', 'style': 'margin-top:14px' }, [ 'Contents (you can also paste them here)' ]),
			ta
		]);

		/* --- Enter manually --- */
		const v = uci.get('network', IFACE) ? this.currentValues()
			: { privatekey: '', address: '', dns: '', mtu: '', publickey: '', presharedkey: '', host: '', port: '51820', allowedips: '0.0.0.0/0, ::/0', keepalive: '25' };
		const inp = {};
		const field = (id, label, hint, o) => {
			o = o || {};
			inp[id] = E('input', { 'type': o.secret ? 'password' : 'text', 'name': 'wg_' + id, 'class': 'cbi-input-text' + (o.mono ? ' roam-mono' : ''), 'value': v[id],
				'placeholder': o.ph || '', 'autocomplete': 'off', 'spellcheck': 'false', 'input': () => showErr(null) });
			return E('div', { 'class': 'roam-field' + (o.wide ? ' wide' : '') }, [
				E('label', { 'class': 'roam-field-label' }, [ label, o.opt ? E('span', { 'class': 'roam-muted' }, [ ' (optional)' ]) : '' ]),
				o.secret ? E('div', { 'class': 'roam-field-row' }, [ inp[id], E('button', { 'type': 'button', 'class': 'btn cbi-button', 'click': (ev) => {
					const show = inp[id].type == 'password'; inp[id].type = show ? 'text' : 'password'; ev.target.textContent = show ? 'Hide' : 'Show';
				} }, [ 'Show' ]) ]) : inp[id],
				hint ? E('div', { 'class': 'roam-muted roam-small' }, [ hint ]) : ''
			]);
		};
		const manualPane = E('div', { 'style': 'display:none' }, [
			E('p', { 'class': 'roam-muted roam-small', 'style': 'margin:0 0 10px' }, [ 'Copy each value from your VPN provider\'s WireGuard settings.' ]),
			E('div', { 'class': 'roam-section-title', 'style': 'margin-top:0' }, [ 'This router (Interface)' ]),
			E('div', { 'class': 'roam-fields' }, [
				field('privatekey', 'Private key', null, { secret: true, mono: true, wide: true, ph: '44 characters, ends with =' }),
				field('address', 'Tunnel address', 'Separate several with commas.', { ph: '10.2.0.2/32' }),
				field('dns', 'DNS servers', null, { opt: true, ph: '10.2.0.1' }),
				field('mtu', 'MTU', null, { opt: true, ph: '1420' })
			]),
			E('div', { 'class': 'roam-section-title' }, [ 'VPN server (Peer)' ]),
			E('div', { 'class': 'roam-fields' }, [
				field('publickey', 'Server public key', null, { mono: true, wide: true, ph: '44 characters, ends with =' }),
				field('host', 'Server address', null, { ph: 'vpn.example.com or 203.0.113.5' }),
				field('port', 'Port', null, { ph: '51820' }),
				field('presharedkey', 'Preshared key', null, { secret: true, mono: true, wide: true, opt: true }),
				field('allowedips', 'Allowed IPs', '0.0.0.0/0, ::/0 sends all traffic through the VPN.', { wide: true }),
				field('keepalive', 'Keepalive (seconds)', null, { opt: true, ph: '25' })
			])
		]);
		const manualText = () => {
			const x = {}; Object.keys(inp).forEach((k) => { x[k] = inp[k].value.trim(); });
			if (x.port && !/^\d{1,5}$/.test(x.port)) return { err: 'The port must be a number (usually 51820).' };
			if (x.mtu && !/^\d{3,4}$/.test(x.mtu)) return { err: 'The MTU must be a number such as 1420, or left empty.' };
			if (x.keepalive && !/^\d{1,4}$/.test(x.keepalive)) return { err: 'Keepalive must be a number of seconds, or left empty.' };
			if (/[\s\[\]]/.test(x.host.replace(/^\[|\]$/g, '')) ) return { err: 'The server address must not contain spaces.' };
			const host = x.host.replace(/^\[|\]$/g, ''), ep = host ? (host.indexOf(':') >= 0 ? '[' + host + ']' : host) + ':' + (x.port || '51820') : '';
			const line = (k, val) => val ? k + ' = ' + val + '\n' : '';
			return { text: '[Interface]\n' + line('PrivateKey', x.privatekey) + line('Address', x.address) + line('DNS', x.dns) + line('MTU', x.mtu) +
				'\n[Peer]\n' + line('PublicKey', x.publickey) + line('PresharedKey', x.presharedkey) + line('Endpoint', ep) +
				line('AllowedIPs', x.allowedips || '0.0.0.0/0, ::/0') + line('PersistentKeepalive', x.keepalive) };
		};

		let mode = 'file';
		const tabs = [ [ 'file', 'From a file' ], [ 'manual', 'Enter manually' ] ].map((t) => E('button', { 'type': 'button', 'class': t[0] == mode ? 'active' : '',
			'click': (ev) => {
				mode = t[0]; showErr(null);
				tabs.forEach((b) => b.classList.toggle('active', b == ev.target));
				filePane.style.display = mode == 'file' ? '' : 'none';
				manualPane.style.display = mode == 'manual' ? '' : 'none';
			} }, [ t[1] ]));

		ui.showModal('WireGuard configuration', [
			E('p', { 'class': 'roam-muted' }, [ 'Get a WireGuard configuration from your VPN provider (Mullvad, Proton VPN, IVPN, your own server, …). Drop the .conf file, choose it, paste it, or type the values in.' ]),
			E('div', { 'class': 'roam-seg', 'role': 'tablist', 'style': 'margin-bottom:14px' }, tabs),
			filePane, manualPane, err,
			E('div', { 'class': 'right', 'style': 'margin-top:14px' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, [ 'Cancel' ]), ' ',
				E('button', { 'class': 'btn cbi-button-action', 'click': () => {
					let t = ta.value;
					if (mode == 'manual') { const r = manualText(); if (r.err) return showErr(r.err); t = r.text; }
					else if (!t.trim()) return showErr('Drop or choose a .conf file, or paste its contents.');
					const m = this.check(t);
					if (m) return showErr(m);
					ui.hideModal();
					return this.importConf(t);
				} }, [ 'Import and connect' ])
			])
		]);
		if (file instanceof File) load(file);
	},

	/* Dropping a .conf file anywhere on the WireGuard card opens the import dialog with it. */
	dropTarget(holder) {
		let depth = 0;
		const files = (ev) => ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') >= 0;
		holder.addEventListener('dragenter', (ev) => { if (!files(ev)) return; ev.preventDefault(); depth++; holder.classList.add('roam-drop-over'); });
		holder.addEventListener('dragover', (ev) => { if (!files(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
		holder.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; holder.classList.remove('roam-drop-over'); } });
		holder.addEventListener('drop', (ev) => {
			if (!files(ev)) return;
			ev.preventDefault(); depth = 0; holder.classList.remove('roam-drop-over');
			if (ev.dataTransfer.files.length) this.importModal(ev.dataTransfer.files[0]);
		});
		/* A file dropped next to a target would otherwise make the browser leave the page. */
		[ 'dragover', 'drop' ].forEach((t) => window.addEventListener(t, (ev) => { if (files(ev) && !ev.defaultPrevented) ev.preventDefault(); }));
	},

	killswitch(on, quiet) {
		if (on && !confirm('Turn on the kill switch? Your devices will only have Internet while the VPN is connected.'))
			return Promise.resolve();
		return fs.exec('/usr/libexec/roam/killswitch', [ on ? 'on' : 'off' ]).then((r) => {
			if (r.code != 0) throw new Error(r.stderr || r.stdout || ('exit ' + r.code));
			if (!quiet) {
				rc.note(on ? 'Kill switch is on.' : 'Kill switch is off.', 'info');
				window.setTimeout(() => location.reload(), 3000);
			}
		}).catch((e) => rc.note('Kill switch change failed: ' + e.message, 'danger'));
	},

	statusCard(data) {
		const nets = data[1], wg = data[2];
		const sec = uci.get('network', IFACE);
		const iface = nets.filter((n) => n.getName() == IFACE)[0];

		if (!sec)
			return rc.card({ icon: 'shield', title: 'WireGuard', off: true, pill: 'Not set up',
				body: [ E('p', { 'class': 'roam-muted' }, [ 'Route all of your devices\' traffic through a VPN. Works with any provider that offers WireGuard configuration files (Mullvad, Proton VPN, IVPN, your own server, …).' ]),
					E('p', { 'class': 'roam-muted roam-small' }, [ 'Tip: drop the provider\'s .conf file onto this card.' ]) ],
				actions: [ E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, 'importModal') }, [ 'Import configuration' ]) ] });

		const enabled = sec.disabled != '1';
		const ks = uci.get('roam', 'main', 'killswitch') == '1';
		const inst = wg[IFACE] || {};
		const peer = Object.values(inst.peers || {})[0] || {};
		const hs = +peer.latest_handshake || 0;
		const age = hs ? Math.floor(Date.now() / 1000) - hs : null;
		const live = enabled && iface && iface.isUp() && age != null && age < 180;

		return rc.card({ icon: 'shield', title: 'WireGuard', off: !live,
			pill: !enabled ? 'Off' : (live ? 'Protected' : 'Connecting'), pillClass: !enabled ? '' : (live ? 'ok' : 'warn'),
			body: [ rc.kv([
				[ 'Server', (uci.get('network', PEER, 'endpoint_host') || '') + ':' + (uci.get('network', PEER, 'endpoint_port') || '') ],
				[ 'Tunnel address', L.toArray(sec.addresses).join(', ') ],
				[ 'Last handshake', age != null ? (age < 60 ? age + ' s ago' : rc.duration(age) + ' ago') : (enabled ? 'none yet' : null) ],
				[ 'Received', enabled ? rc.bytes(peer.transfer_rx) : null ],
				[ 'Sent', enabled ? rc.bytes(peer.transfer_tx) : null ]
			]),
			E('div', { 'class': 'roam-section-title' }, [ 'Kill switch' ]),
			E('div', { 'style': 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between' }, [
				E('span', { 'class': 'roam-pill ' + (ks ? 'ok' : '') }, [ ks ? 'On \u2013 no traffic outside the VPN' : 'Off' ]),
				E('button', { 'class': 'btn ' + (ks ? 'cbi-button' : 'cbi-button-action'), 'click': ui.createHandlerFn(this, () => this.killswitch(!ks)) },
					[ ks ? 'Turn kill switch off' : 'Turn kill switch on' ])
			]),
			E('p', { 'class': 'roam-muted roam-small', 'style': 'margin-top:8px' }, [ ks
				? 'Your devices can only reach the Internet through the VPN. If the tunnel drops, they are cut off until it reconnects, and their DNS lookups never go to the local network. To sign in to a hotel Wi-Fi portal, turn the kill switch off first.'
				: 'Blocks your devices from the Internet whenever the VPN is not connected, so nothing ever leaks out unprotected (including DNS lookups).' ]),
			(enabled && !live) ? E('p', { 'class': 'roam-muted roam-small', 'style': 'margin-top:10px' }, [ 'While the tunnel is connecting, traffic is routed into the tunnel and will not get through. If this lasts more than a minute, check the configuration or turn the VPN off.' ]) : ''
			],
			actions: [
				E('button', { 'class': 'btn ' + (enabled ? 'cbi-button' : 'cbi-button-action'), 'click': ui.createHandlerFn(this, () => {
					/* Turning the VPN off also turns the kill switch off (otherwise: no Internet at all). */
					const pre = (enabled && ks) ? this.killswitch(false, true) : Promise.resolve();
					return pre.then(() => {
						uci.set('network', IFACE, 'disabled', enabled ? '1' : '0');
						return rc.apply();
					});
				}) }, [ enabled ? 'Turn off' : 'Turn on' ]),
				E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, 'importModal') }, [ 'Change configuration' ]),
				E('button', { 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, () => {
					if (!confirm('Remove the WireGuard configuration?')) return;
					return (ks ? this.killswitch(false, true) : Promise.resolve()).then(() => { uci.unload([ 'network', 'firewall', 'roam' ]); return uci.load([ 'network', 'firewall', 'roam' ]); }).then(() => {
					uci.remove('network', IFACE); uci.remove('network', PEER);
					const z = wanZone();
					if (z) uci.set('firewall', z['.name'], 'network', L.toArray(z.network).filter((n) => n != IFACE));
					return rc.apply();
					});
				}) }, [ 'Remove' ])
			] });
	},

	render(data) {
		const holder = E('div', { 'class': 'roam-drop-card' }, [ this.statusCard(data) ]);
		this.dropTarget(holder);
		poll.add(() => {
			network.flushCache();
			return this.load().then((d) => holder.replaceChildren(this.statusCard(d)));
		}, 10);

		return E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Protect your traffic on untrusted networks. When the VPN is on, every device on your Wi-Fi uses it automatically.' ]),
			E('div', { 'class': 'roam-grid' }, [
				holder,
				rc.card({ icon: 'lock', title: 'More VPN options', body: [
					E('p', { 'class': 'roam-muted' }, [ 'OpenVPN client/server, a WireGuard server for connecting home, and per-device routing are available in the full OpenWrt settings.' ])
				], actions: [
					E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/network/network') }, [ 'Interfaces' ]),
					E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/vpn') }, [ 'OpenVPN' ])
				] })
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
