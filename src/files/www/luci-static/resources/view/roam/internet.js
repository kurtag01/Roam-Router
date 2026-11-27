'use strict';
'require view';
'require network';
'require uci';
'require ui';
'require poll';
'require roam.common as rc';

/* Internet sources: Ethernet port (LAN or WAN), Repeater (Wi-Fi client "wwan"),
   USB tethering. Also manages the MAC address of the repeater (client) radio. */

function scanEncryption(enc) {
	if (!enc || !enc.enabled) return { uci: 'none', label: 'Open' };
	const wpa = enc.wpa || [], auth = enc.authentication || [];
	if (auth.indexOf('802.1x') >= 0) return { uci: null, label: 'Enterprise (802.1X)' };
	if (auth.indexOf('owe') >= 0) return { uci: 'owe', label: 'Enhanced Open' };
	if (enc.wep) return { uci: null, label: 'WEP (insecure)' };
	const sae = auth.indexOf('sae') >= 0, psk = auth.indexOf('psk') >= 0;
	/* WPA2/WPA3 networks: join with WPA2. The Pi's built-in Broadcom radio (brcmfmac)
	   cannot do WPA3-SAE authentication in client mode, and WPA2 works on every chip. */
	if (sae && psk) return { uci: 'psk2', label: 'WPA2/WPA3' };
	if (sae) return { uci: 'sae', label: 'WPA3' };
	if (wpa.indexOf(1) >= 0 && wpa.indexOf(2) >= 0) return { uci: 'psk-mixed', label: 'WPA/WPA2' };
	if (wpa.indexOf(1) >= 0) return { uci: 'psk', label: 'WPA' };
	return { uci: 'psk2', label: 'WPA2' };
}

function lanBridge() {
	return uci.sections('network', 'device').filter((s) => s.name == 'br-lan')[0];
}

return view.extend({
	load() {
		return Promise.all([
			uci.load([ 'network', 'wireless', 'roam' ]),
			network.getNetworks(),
			network.getWifiNetworks(),
			network.getHostHints(),
			network.getWifiDevices()
		]);
	},

	/* ---------------- Ethernet ---------------- */
	ethernetCard(nets) {
		const br = lanBridge();
		const ports = br ? L.toArray(br.ports) : [];
		const isWan = ports.indexOf('eth0') < 0 && uci.get('network', 'wan', 'disabled') != '1';
		const wan = nets.filter((n) => n.getName() == 'wan')[0];
		const up = isWan && wan && wan.isUp();

		const proto = E('select', {}, [
			E('option', { 'value': 'dhcp' }, [ 'Automatic (DHCP)' ]),
			E('option', { 'value': 'static' }, [ 'Static IP' ]),
			E('option', { 'value': 'pppoe' }, [ 'PPPoE (DSL/fiber login)' ])
		]);
		proto.value = uci.get('network', 'wan', 'proto') || 'dhcp';
		const f = {
			ipaddr: E('input', { 'type': 'text', 'placeholder': '192.168.1.50', 'value': uci.get('network', 'wan', 'ipaddr') || '' }),
			netmask: E('input', { 'type': 'text', 'placeholder': '255.255.255.0', 'value': uci.get('network', 'wan', 'netmask') || '' }),
			gateway: E('input', { 'type': 'text', 'placeholder': '192.168.1.1', 'value': uci.get('network', 'wan', 'gateway') || '' }),
			dns: E('input', { 'type': 'text', 'placeholder': '1.1.1.1 9.9.9.9', 'value': L.toArray(uci.get('network', 'wan', 'dns')).join(' ') }),
			username: E('input', { 'type': 'text', 'value': uci.get('network', 'wan', 'username') || '' }),
			password: E('input', { 'type': 'password', 'value': uci.get('network', 'wan', 'password') || '' })
		};
		const row = (label, el, protos) => E('div', { 'class': 'cbi-value', 'data-protos': protos }, [
			E('label', { 'class': 'cbi-value-title' }, [ label ]), E('div', { 'class': 'cbi-value-field' }, [ el ]) ]);
		const fields = E('div', { 'style': isWan ? '' : 'display:none' }, [
			row('Connection type', proto, 'all'),
			row('IP address', f.ipaddr, 'static'), row('Netmask', f.netmask, 'static'), row('Gateway', f.gateway, 'static'),
			row('DNS servers', f.dns, 'static'),
			row('Username', f.username, 'pppoe'), row('Password', f.password, 'pppoe')
		]);
		const showProto = () => fields.querySelectorAll('[data-protos]').forEach((r) => {
			const p = r.getAttribute('data-protos');
			r.style.display = (p == 'all' || p == proto.value) ? '' : 'none';
		});
		proto.addEventListener('change', showProto);
		showProto();

		const save = () => {
			const p = proto.value;
			uci.set('network', 'wan', 'proto', p);
			[ 'ipaddr', 'netmask', 'gateway', 'username', 'password' ].forEach((k) => uci.unset('network', 'wan', k));
			uci.unset('network', 'wan', 'dns');
			if (p == 'static') {
				if (!f.ipaddr.value || !f.netmask.value) return rc.note('Static IP needs an IP address and netmask.', 'warning');
				uci.set('network', 'wan', 'ipaddr', f.ipaddr.value.trim());
				uci.set('network', 'wan', 'netmask', f.netmask.value.trim());
				if (f.gateway.value.trim()) uci.set('network', 'wan', 'gateway', f.gateway.value.trim());
				const dns = f.dns.value.trim().split(/[\s,]+/).filter(Boolean);
				if (dns.length) uci.set('network', 'wan', 'dns', dns);
			} else if (p == 'pppoe') {
				uci.set('network', 'wan', 'username', f.username.value);
				uci.set('network', 'wan', 'password', f.password.value);
			}
			return rc.apply();
		};

		const setMode = (toWan) => {
			const b = lanBridge();
			let pl = b ? L.toArray(b.ports).filter((x) => x != 'eth0') : [];
			if (!toWan) pl.push('eth0');
			if (b) {
				if (pl.length) uci.set('network', b['.name'], 'ports', pl);
				else uci.unset('network', b['.name'], 'ports');
			}
			uci.set('network', 'wan', 'disabled', toWan ? '0' : '1');
			uci.set('network', 'wan6', 'disabled', toWan ? '0' : '1');
			return rc.apply();
		};

		const modeBtn = isWan
			? E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, () => setMode(false)) }, [ 'Use port as LAN' ])
			: E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, () => {
				ui.showModal('Use Ethernet for Internet?', [
					E('p', {}, [ 'The Ethernet port will connect to a modem or wired network instead of a computer. If you are connected to this router by cable right now, reconnect over Wi-Fi afterwards.' ]),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, [ 'Cancel' ]), ' ',
						E('button', { 'class': 'btn cbi-button-action', 'click': () => { ui.hideModal(); setMode(true); } }, [ 'Switch to Internet' ])
					])
				]);
			}) }, [ 'Use port for Internet' ]);

		return rc.card({ icon: 'ethernet', title: 'Ethernet', off: !up,
			pill: isWan ? (up ? 'Connected' : 'No connection') : 'LAN port', pillClass: isWan ? (up ? 'ok' : 'warn') : '',
			body: [
				E('p', { 'class': 'roam-muted' }, [ isWan ? 'The Ethernet port is used as the Internet connection (WAN).'
					: 'The Ethernet port is a LAN port for a computer or switch. Switch it to Internet mode to plug into a modem or hotel wall jack.' ]),
				up ? rc.kv([ [ 'IP address', wan.getIPAddr() ], [ 'Gateway', wan.getGatewayAddr() ] ]) : '',
				fields
			],
			actions: [ modeBtn ].concat(isWan ? [ E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, save) }, [ 'Save' ]) ] : [])
		});
	},

	/* ---------------- Repeater ---------------- */
	repeaterCard(nets, wifis, hints) {
		const s = uci.get('wireless', 'wwan');
		if (!s)
			return rc.card({ icon: 'repeater', title: 'Repeater', off: true, pill: 'No radio', pillClass: 'warn', body: [
				E('p', { 'class': 'roam-muted' }, [ 'No Wi-Fi radio is set up yet. If you just plugged in a USB adapter, give it a minute, then reload. Radios can be assigned on the Wireless page.' ]) ] });

		const sta = wifis.filter((w) => w.getName() == 'wwan')[0];
		const wwan = nets.filter((n) => n.getName() == 'wwan')[0];
		const enabled = s.disabled != '1' && s.ssid;
		const connected = enabled && sta && sta.isUp() && sta.getActiveBSSID() && sta.getActiveBSSID() != '00:00:00:00:00:00';
		const online = connected && wwan && wwan.isUp() && wwan.getIPAddr();
		const radio = s.device;
		const radioDev = (this.radios || []).filter((r) => r.getName() == radio)[0];

		const clones = hints.getMACHints().map((h) => ({ mac: h[0].toLowerCase(), label: h[1] || 'device' }));
		const factory = (!s.macaddr && this.staMac) ? this.staMac : null;
		const mac = rc.macEditor(s.macaddr || '', factory, clones);
		this.wwanMac = { editor: mac, current: s.macaddr || '' };

		const body = [];
		if (enabled)
			body.push(E('div', { 'class': 'roam-big', 'style': 'margin-bottom:10px' }, [ s.ssid ]));
		else
			body.push(E('p', { 'class': 'roam-muted' }, [ 'Connect this router to an existing Wi-Fi network (hotel, home, phone hotspot) and share it with your devices.' ]));
		if (enabled)
			body.push(rc.kv([
				[ 'Status', online ? 'Online' : (connected ? 'Connected, getting address…' : 'Searching / wrong password?') ],
				[ 'Signal', (connected && sta.getSignal()) ? E('span', {}, [ rc.signal(sta.getSignal()), ' ', String(sta.getSignal()) + ' dBm' ]) : null ],
				[ 'IP address', online ? wwan.getIPAddr() : null ],
				[ 'Gateway', online ? wwan.getGatewayAddr() : null ],
				[ 'Using radio', radioDev ? radioDev.getI18n() : radio ],
				[ 'MAC in use', this.staMac ? E('span', { 'class': 'roam-mono' }, [ this.staMac ]) : null ]
			]));

		body.push(E('div', { 'class': 'roam-section-title' }, [ 'MAC address of the repeater radio' ]));
		body.push(E('p', { 'class': 'roam-muted roam-small' }, [ 'This is the address the upstream network (and its captive portal) sees. Use Random for privacy, or copy a device\'s address so a portal you already accepted on that device lets the router in.' ]));
		body.push(mac.node);

		const saveMac = () => {
			let v;
			try { v = mac.getValue(); } catch (e) { return rc.note(e.message, 'warning'); }
			if (v) uci.set('wireless', 'wwan', 'macaddr', v); else uci.unset('wireless', 'wwan', 'macaddr');
			return (v != (s.macaddr || '')) ? rc.applyMac('wwan', v) : rc.apply();
		};

		const actions = [
			E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, 'scan', radio) }, [ enabled ? 'Change network' : 'Scan for networks' ]),
			E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, 'joinModal', null) }, [ 'Hidden network…' ]),
			E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, saveMac) }, [ 'Save MAC address' ])
		];
		if (enabled)
			actions.push(E('button', { 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, () => {
				uci.set('wireless', 'wwan', 'disabled', '1');
				return rc.apply();
			}) }, [ 'Disconnect' ]));

		return rc.card({ icon: 'repeater', title: 'Repeater', off: !online,
			pill: !enabled ? 'Off' : (online ? 'Connected' : 'Connecting'), pillClass: !enabled ? '' : (online ? 'ok' : 'warn'),
			body: body, actions: actions });
	},

	scan(radio) {
		const list = E('div', {}, [ E('p', { 'class': 'spinning' }, [ 'Scanning for networks… (this can take up to 20 seconds)' ]) ]);
		ui.showModal('Nearby Wi-Fi networks', [
			list,
			E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, [ 'Close' ]) ])
		]);

		return network.getWifiDevice(radio).then((dev) => dev ? dev.getScanList() : []).then((res) => {
			const seen = {};
			res = res.filter((r) => r.ssid).sort((a, b) => (b.signal || -100) - (a.signal || -100))
				.filter((r) => { if (seen[r.ssid]) return false; seen[r.ssid] = true; return true; });

			if (!res.length) {
				list.replaceChildren(E('p', {}, [ 'No networks found. Move closer, or try again.' ]));
				return;
			}

			list.replaceChildren(E('ul', { 'class': 'roam-list' }, res.map((r) => {
				const enc = scanEncryption(r.encryption);
				return E('li', {}, [
					rc.signal(r.signal),
					E('span', { 'class': 'grow' }, [ E('strong', {}, [ r.ssid ]),
						E('span', { 'class': 'roam-muted roam-small' }, [ enc.label + ' · channel ' + r.channel + ' · ' + r.signal + ' dBm' ]) ]),
					enc.uci ? E('button', { 'class': 'btn cbi-button-action', 'click': () => this.joinModal({ ssid: r.ssid, enc: enc.uci, label: enc.label }) }, [ 'Join' ])
						: E('span', { 'class': 'roam-muted roam-small' }, [ 'Use Advanced' ])
				]);
			})));
		}).catch((e) => list.replaceChildren(E('p', {}, [ 'Scan failed: ' + e.message ])));
	},

	joinModal(net) {
		const ssid = E('input', { 'type': 'text', 'value': net ? net.ssid : '' });
		const enc = E('select', {}, [
			E('option', { 'value': 'psk2' }, [ 'WPA2' ]), E('option', { 'value': 'sae-mixed' }, [ 'WPA2/WPA3' ]),
			E('option', { 'value': 'sae' }, [ 'WPA3' ]), E('option', { 'value': 'psk-mixed' }, [ 'WPA/WPA2' ]),
			E('option', { 'value': 'owe' }, [ 'Enhanced Open' ]), E('option', { 'value': 'none' }, [ 'Open (no password)' ])
		]);
		enc.value = net ? net.enc : 'psk2';
		const key = E('input', { 'type': 'password', 'autocomplete': 'off' });
		const show = E('label', { 'class': 'roam-small' }, [ E('input', { 'type': 'checkbox', 'change': (ev) => { key.type = ev.target.checked ? 'text' : 'password'; } }), ' Show password' ]);
		const keyRow = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'Password' ]), E('div', { 'class': 'cbi-value-field' }, [ key, E('br'), show ]) ]);
		const sync = () => { keyRow.style.display = (enc.value == 'none' || enc.value == 'owe') ? 'none' : ''; };
		enc.addEventListener('change', sync); sync();

		ui.showModal(net ? 'Join "' + net.ssid + '"' : 'Join a hidden network', [
			net ? '' : E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'Network name (SSID)' ]), E('div', { 'class': 'cbi-value-field' }, [ ssid ]) ]),
			E('div', { 'class': 'cbi-value', 'style': net ? 'display:none' : '' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'Security' ]), E('div', { 'class': 'cbi-value-field' }, [ enc ]) ]),
			net ? E('p', { 'class': 'roam-muted' }, [ 'Security: ' + net.label ]) : '',
			keyRow,
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, [ 'Cancel' ]), ' ',
				E('button', { 'class': 'btn cbi-button-action', 'click': () => {
					const e = enc.value, k = key.value;
					if (!ssid.value) return;
					if (e != 'none' && e != 'owe' && (k.length < 8 || k.length > 63)) { rc.note('Wi-Fi passwords are 8 to 63 characters.', 'warning'); return; }
					uci.set('wireless', 'wwan', 'ssid', ssid.value);
					uci.set('wireless', 'wwan', 'encryption', e);
					if (e == 'none' || e == 'owe') uci.unset('wireless', 'wwan', 'key'); else uci.set('wireless', 'wwan', 'key', k);
					uci.set('wireless', 'wwan', 'disabled', '0');
					if (!net) uci.set('wireless', 'wwan', 'hidden', '1'); else uci.unset('wireless', 'wwan', 'hidden');
					/* Also save the MAC choice shown on the page (Factory/Random/Custom). */
					let m = null;
					if (this.wwanMac) {
						try { m = this.wwanMac.editor.getValue(); } catch (err) { rc.note(err.message, 'warning'); return; }
						if (m) uci.set('wireless', 'wwan', 'macaddr', m); else uci.unset('wireless', 'wwan', 'macaddr');
					}
					ui.hideModal();
					return (m != null && m != this.wwanMac.current) ? rc.applyMac('wwan', m) : rc.apply();
				} }, [ 'Connect' ])
			])
		]);
	},

	/* ---------------- Tethering ---------------- */
	tetherCard(nets) {
		const t = nets.filter((n) => (n.getName() == 'tether' || n.getName() == 'tether_ios') && n.isUp() && n.getIPAddr())[0];
		return rc.card({ icon: 'phone', title: 'USB Tethering', off: !t, pill: t ? 'Connected' : 'No phone', pillClass: t ? 'ok' : '',
			body: [
				t ? rc.kv([ [ 'Device', t.getName() == 'tether_ios' ? 'iPhone / iPad' : 'Phone (USB)' ], [ 'IP address', t.getIPAddr() ], [ 'Gateway', t.getGatewayAddr() ] ])
					: E('p', { 'class': 'roam-muted' }, [ 'Plug a phone into a USB port and turn on USB tethering (Android: Settings › Hotspot & tethering; iPhone: Personal Hotspot, then tap "Trust"). It is used automatically.' ])
			] });
	},

	render(data) {
		const nets = data[1], wifis = data[2], hints = data[3];
		this.radios = data[4] || [];

		/* Show the repeater interface's real MAC address. */
		const sta = wifis.filter((w) => w.getName() == 'wwan')[0];
		if (sta && sta.getIfname()) {
			const dev = sta.getDevice ? sta.getDevice() : null;
			this.staMac = dev && dev.getMAC ? dev.getMAC() : null;
		}

		const view = E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Choose how this router gets online. Ethernet (WAN), USB tethering and the repeater can all be active; the first one that works is used.' ]),
			E('div', { 'class': 'roam-grid' }, [ this.repeaterCard(nets, wifis, hints), this.ethernetCard(nets), this.tetherCard(nets) ])
		]);

		return view;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
