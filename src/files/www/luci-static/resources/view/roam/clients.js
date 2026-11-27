'use strict';
'require view';
'require network';
'require rpc';
'require uci';
'require ui';
'require poll';
'require roam.common as rc';

const callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
const AP_IFACES = [ 'ap', 'guest' ];

function blockedList() {
	const all = {};
	AP_IFACES.forEach((sid) => {
		if (uci.get('wireless', sid, 'macfilter') == 'deny')
			L.toArray(uci.get('wireless', sid, 'maclist')).forEach((m) => all[m.toLowerCase()] = true);
	});
	return Object.keys(all);
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('wireless'),
			network.getWifiNetworks(),
			network.getHostHints(),
			L.resolveDefault(callLeases(), {})
		]).then((r) => Promise.all(r[1].map((w) => L.resolveDefault(w.getAssocList(), []))).then((a) => { r.push(a); return r; }));
	},

	block(mac, wifis) {
		mac = mac.toLowerCase();
		AP_IFACES.forEach((sid) => {
			if (!uci.get('wireless', sid)) return;
			const cur = (uci.get('wireless', sid, 'macfilter') == 'deny') ? L.toArray(uci.get('wireless', sid, 'maclist')) : [];
			if (cur.map((m) => m.toLowerCase()).indexOf(mac) < 0) cur.push(mac);
			uci.set('wireless', sid, 'macfilter', 'deny');
			uci.set('wireless', sid, 'maclist', cur);
		});
		/* Kick it off right away as well. */
		wifis.forEach((w) => { if (w.getMode() == 'ap' && w.isUp() && w.isClientDisconnectSupported()) L.resolveDefault(w.disconnectClient(mac, true, 5, 60000)); });
		return rc.apply();
	},

	unblock(mac) {
		AP_IFACES.forEach((sid) => {
			if (!uci.get('wireless', sid)) return;
			const rest = L.toArray(uci.get('wireless', sid, 'maclist')).filter((m) => m.toLowerCase() != mac);
			if (rest.length) uci.set('wireless', sid, 'maclist', rest);
			else { uci.unset('wireless', sid, 'maclist'); uci.unset('wireless', sid, 'macfilter'); }
		});
		return rc.apply();
	},

	table(data) {
		const wifis = data[1], hints = data[2], leases = (data[3].dhcp_leases || []), assoc = data[4];
		const clients = {};

		leases.forEach((l) => {
			const mac = (l.macaddr || '').toLowerCase();
			if (!mac) return;
			clients[mac] = { mac: mac, name: l.hostname, ip: l.ipaddr, conn: 'Wired / other', signal: null, expires: l.expires };
		});
		wifis.forEach((w, i) => {
			if (w.getMode() != 'ap') return;
			(assoc[i] || []).forEach((st) => {
				const mac = st.mac.toLowerCase();
				const c = clients[mac] || (clients[mac] = { mac: mac });
				c.conn = (w.getNetworkNames()[0] == 'guest' ? 'Guest · ' : '') + (w.getActiveSSID() || 'Wi-Fi');
				c.signal = st.signal;
				c.rx = st.rx ? st.rx.rate : null;
				c.wifi = w;
			});
		});

		const list = Object.values(clients).map((c) => {
			c.name = c.name || hints.getHostnameByMACAddr(c.mac) || '';
			c.ip = c.ip || hints.getIPAddrByMACAddr(c.mac) || '';
			return c;
		}).sort((a, b) => (b.wifi ? 1 : 0) - (a.wifi ? 1 : 0) || (a.name || 'zz').localeCompare(b.name || 'zz'));

		if (!list.length)
			return E('p', { 'class': 'roam-muted' }, [ 'No devices are connected right now.' ]);

		return E('table', { 'class': 'roam-table' }, [
			E('thead', {}, [ E('tr', {}, [ 'Device', 'IP address', 'MAC address', 'Connection', 'Signal', '' ].map((h) => E('th', {}, [ h ]))) ]),
			E('tbody', {}, list.map((c) => E('tr', {}, [
				E('td', { 'data-title': 'Device' }, [ E('strong', {}, [ c.name || 'Unknown device' ]) ]),
				E('td', { 'data-title': 'IP address' }, [ c.ip || '—' ]),
				E('td', { 'data-title': 'MAC address', 'class': 'roam-mono' }, [ c.mac ]),
				E('td', { 'data-title': 'Connection' }, [ c.wifi ? c.conn : E('span', { 'class': 'roam-muted' }, [ c.conn ]) ]),
				E('td', { 'data-title': 'Signal' }, [ c.signal ? E('span', {}, [ rc.signal(c.signal), ' ', c.signal + ' dBm' ]) : '—' ]),
				E('td', { 'data-title': '' }, [ c.wifi ? E('button', { 'class': 'btn cbi-button-negative', 'click': ui.createHandlerFn(this, 'block', c.mac, wifis) }, [ 'Block' ]) : '' ])
			])))
		]);
	},

	render(data) {
		const holder = E('div', {}, [ this.table(data) ]);
		const blocked = blockedList();
		const hints = data[2];

		poll.add(() => {
			network.flushCache();
			return this.load().then((d) => holder.replaceChildren(this.table(d)));
		}, 10);

		return E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Devices connected to this router. Blocking a Wi-Fi device disconnects it and keeps it off both your main and guest Wi-Fi.' ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, [ 'Connected devices' ]), holder ]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ 'Blocked devices' ]),
				blocked.length ? E('ul', { 'class': 'roam-list' }, blocked.map((m) => E('li', {}, [
					E('span', { 'class': 'grow' }, [ E('strong', {}, [ hints.getHostnameByMACAddr(m) || 'Device' ]), E('span', { 'class': 'roam-mono roam-muted' }, [ m ]) ]),
					E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, 'unblock', m) }, [ 'Unblock' ])
				]))) : E('p', { 'class': 'roam-muted' }, [ 'No blocked devices.' ])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
