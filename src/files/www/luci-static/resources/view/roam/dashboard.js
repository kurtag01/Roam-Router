'use strict';
'require view';
'require network';
'require rpc';
'require uci';
'require poll';
'require fs';
'require roam.common as rc';
'require roam.apps as apps';

const callSystemInfo = rpc.declare({ object: 'system', method: 'info' });
const callBoard = rpc.declare({ object: 'system', method: 'board' });
const callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
const callWg = rpc.declare({ object: 'luci.wireguard', method: 'getWgInstances', expect: { '': {} } });

const UPLINKS = {
	wan: 'Ethernet', wwan: 'Repeater', tether: 'USB tethering', tether_ios: 'iPhone tethering', wgclient: 'WireGuard VPN'
};

return view.extend({
	load() {
		return Promise.all([
			network.getNetworks(),
			network.getWifiNetworks(),
			network.getWANNetworks(),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callBoard(), {}),
			L.resolveDefault(callLeases(), {}),
			uci.load([ 'wireless', 'system', 'network', 'roam' ]),
			L.resolveDefault(callWg(), {})
		]).then((r) => {
			const wifis = r[1];
			return Promise.all(wifis.map((w) => L.resolveDefault(w.getAssocList(), []))).then((assoc) => {
				r.push(assoc);
				return r;
			});
		});
	},

	renderCards(data) {
		const nets = data[0], wifis = data[1], wans = data[2], info = data[3], board = data[4], leases = data[5], wgi = data[7] || {}, assoc = data[8];
		const byName = {};
		nets.forEach((n) => byName[n.getName()] = n);

		/* ---- Internet ---- */
		const wan = wans.filter((n) => n.getName() != 'wgclient')[0] || wans[0];
		let inet;
		if (wan) {
			const name = wan.getName();
			let via = UPLINKS[name] || name;
			if (name == 'wwan') {
				const sta = wifis.filter((w) => w.getMode() == 'sta' && w.isUp())[0];
				if (sta && sta.getActiveSSID()) via += ' · ' + sta.getActiveSSID();
			}
			inet = rc.card({ icon: 'globe', title: 'Internet', pill: 'Connected', pillClass: 'ok', body: [
				E('div', { 'class': 'roam-big', 'style': 'margin-bottom:10px' }, [ via ]),
				rc.kv([
					[ 'IP address', wan.getIPAddr() ],
					[ 'Gateway', wan.getGatewayAddr() ],
					[ 'DNS', (wan.getDNSAddrs() || []).join(', ') ],
					[ 'Connected for', wan.getUptime() ? rc.duration(wan.getUptime()) : null ]
				])
			], actions: [ E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/roam/internet') }, [ 'Manage' ]) ] });
		} else {
			inet = rc.card({ icon: 'globe', off: true, title: 'Internet', pill: 'Not connected', pillClass: 'bad', body: [
				E('p', { 'class': 'roam-muted' }, [ 'Connect to a Wi-Fi network (Repeater), plug in a phone for tethering, or switch the Ethernet port to Internet mode.' ])
			], actions: [ E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/roam/internet') }, [ 'Connect to Internet' ]) ] });
		}

		/* ---- Wi-Fi ---- */
		const aps = wifis.filter((w) => w.getMode() == 'ap' && !w.isDisabled());
		const apRows = aps.map((w) => E('li', {}, [
			E('span', { 'class': 'grow' }, [ E('strong', {}, [ w.getActiveSSID() || w.getSSID() || '?' ]),
				E('span', { 'class': 'roam-muted roam-small' }, [ (w.getNetworkNames()[0] == 'guest' ? 'Guest · ' : '') + (w.getActiveBSSID() || '') ]) ]),
			E('span', { 'class': 'roam-pill ' + (w.isUp() ? 'ok' : 'warn') }, [ w.isUp() ? 'On' : 'Starting' ])
		]));
		const defKey = uci.get('wireless', 'ap', 'key') == 'roam-pi-setup';
		const wifiCard = rc.card({ icon: 'wifi', title: 'Wi-Fi', off: !aps.length, pill: aps.length ? aps.length + ' network' + (aps.length > 1 ? 's' : '') : 'Off',
			pillClass: aps.length ? 'ok' : 'warn', body: [
				aps.length ? E('ul', { 'class': 'roam-list' }, apRows) : E('p', { 'class': 'roam-muted' }, [ 'No Wi-Fi network is being broadcast.' ]),
				defKey ? E('div', { 'class': 'alert-message warning', 'style': 'margin:12px 0 0' }, [ 'The Wi-Fi password is still the default. Change it on the Wireless page.' ]) : ''
			], actions: [ E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/roam/wireless') }, [ 'Manage' ]) ] });

		/* ---- Clients ---- */
		let wifiClients = 0;
		wifis.forEach((w, i) => { if (w.getMode() == 'ap') wifiClients += (assoc[i] || []).length; });
		const nLeases = (leases.dhcp_leases || []).length;
		const clientCard = rc.card({ icon: 'users', title: 'Clients', body: [
			E('div', { 'class': 'roam-big' }, [ String(wifiClients) ]),
			E('div', { 'class': 'roam-muted', 'style': 'margin-bottom:10px' }, [ 'connected over Wi-Fi' ]),
			rc.kv([ [ 'Devices with an address (DHCP)', String(nLeases) ] ])
		], actions: [ E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/roam/clients') }, [ 'View clients' ]) ] });

		/* ---- VPN ---- */
		const wg = byName.wgclient;
		const wgOn = wg && uci.get('network', 'wgclient', 'disabled') != '1';
		const peer = Object.values((wgi.wgclient || {}).peers || {})[0] || {};
		const hs = +peer.latest_handshake || 0;
		const wgLive = wgOn && wg.isUp() && hs && (Date.now() / 1000 - hs) < 180;
		const vpnCard = rc.card({ icon: 'shield', title: 'VPN', off: !wgLive,
			pill: !wg ? 'Not set up' : (wgLive ? 'Protected' : (wgOn ? 'Connecting' : 'Off')),
			pillClass: !wg ? '' : (wgLive ? 'ok' : (wgOn ? 'warn' : '')), body: [
				E('p', { 'class': 'roam-muted' }, [ !wg ? 'Import a WireGuard configuration from your VPN provider to route all traffic through it.'
					: (wgLive ? 'All traffic leaves through the WireGuard tunnel.' : (wgOn ? 'Waiting for the VPN server to answer.' : 'The WireGuard tunnel is off.')) ]),
				uci.get('roam', 'main', 'killswitch') == '1' ? E('p', { 'class': 'roam-small' }, [ E('span', { 'class': 'roam-pill ' + (wgLive ? 'ok' : 'warn') }, [ wgLive ? 'Kill switch on' : 'Kill switch on \u2013 devices offline until VPN connects' ]) ]) : ''
			], actions: [ E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/roam/vpn') }, [ 'Manage' ]) ] });

		/* ---- System ---- */
		const mem = info.memory || {};
		const memPct = mem.total ? Math.round(100 * (mem.total - (mem.available || mem.free)) / mem.total) : 0;
		const load = (info.load || [0])[0] / 65536;
		const sysCard = rc.card({ icon: 'cpu', title: 'System', body: [
			rc.kv([
				[ 'Hostname', board.hostname ],
				[ 'Model', board.model ],
				[ 'Firmware', (this.upd && this.upd.current) ? 'Roam ' + this.upd.current + ' (OpenWrt ' + (this.upd.openwrt_current || '?') + ')'
					: (board.release ? board.release.description : null) ],
				[ 'Uptime', rc.duration(info.uptime) ],
				[ 'Load', load.toFixed(2) ],
				[ 'Memory', memPct + '% used' ]
			]),
			E('div', { 'class': 'roam-bar' }, [ E('span', { 'style': 'width:' + memPct + '%' }) ]),
			(this.upd && this.upd.newer === true) ? E('div', { 'class': 'alert-message notice', 'style': 'margin:12px 0 0' }, [
				'Roam ' + this.upd.latest + ' is available. ', E('a', { 'href': L.url('admin/roam/update') }, [ 'See Updates' ]) ]) : ''
		], actions: [ E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/roam/system') }, [ 'Manage' ]),
			E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/roam/update') }, [ 'Updates' ]) ] });

		/* ---- Apps (Roam host only) ---- */
		const cards = [ inet, wifiCard, clientCard, vpnCard ];
		if (apps.enabled()) cards.push(apps.card(this.appStatus));
		cards.push(sysCard);

		return E('div', { 'class': 'roam-grid' }, cards);
	},

	render(data) {
		this.appStatus = null;
		this.upd = null;
		L.resolveDefault(fs.exec_direct('/usr/libexec/roam/update', [ 'cached' ], 'json'), null).then((u) => {
			this.upd = u; holder.replaceChildren(this.renderCards(last));
		});
		const holder = E('div', {}, [ this.renderCards(data) ]);
		let last = data;

		if (apps.enabled()) {
			const check = () => apps.status().then((st) => {
				this.appStatus = st;
				holder.replaceChildren(this.renderCards(last));
			});
			check();
			poll.add(check, 15);
		}

		poll.add(() => {
			network.flushCache();
			return this.load().then((d) => { last = d; holder.replaceChildren(this.renderCards(d)); });
		}, 5);

		return E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Your travel router at a glance. Everything here updates automatically.' ]),
			holder
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
