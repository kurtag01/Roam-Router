'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require rpc';
'require ui';
'require roam.common as rc';

/* LAN address, DHCP range, DNS servers and encrypted DNS. */

const callRcList = rpc.declare({ object: 'rc', method: 'list', params: [ 'name' ], expect: { '': {} } });
const PROVIDERS = [
	[ 'off', 'Off (use the network\'s DNS)' ],
	[ 'cloudflare', 'Cloudflare (1.1.1.1) \u2013 fast, privacy-focused' ],
	[ 'quad9', 'Quad9 \u2013 blocks known malware domains' ],
	[ 'mullvad', 'Mullvad \u2013 no logging' ],
	[ 'mullvad-adblock', 'Mullvad + ad blocking' ],
	[ 'adguard', 'AdGuard \u2013 blocks ads and trackers' ],
	[ 'google', 'Google Public DNS' ],
	[ 'custom', 'Custom DNS-over-HTTPS server\u2026' ]
];

return view.extend({
	load() {
		return Promise.all([
			uci.load([ 'network', 'dhcp', 'roam' ]),
			L.resolveDefault(callRcList('https-dns-proxy'), {})
		]);
	},

	dohCard(rcinfo) {
		const svc = rcinfo['https-dns-proxy'];
		const cur = uci.get('roam', 'main', 'doh') || 'off';
		const running = !!(svc && svc.running);
		const on = cur != 'off';

		if (!svc)
			return rc.card({ icon: 'lock', title: 'Encrypted DNS', off: true, pill: 'Not installed', body: [
				E('p', { 'class': 'roam-muted' }, [ 'Install the "https-dns-proxy" package (System \u203a Software) to use encrypted DNS.' ]) ] });

		const sel = E('select', {}, PROVIDERS.map((p) => E('option', { 'value': p[0] }, [ p[1] ])));
		sel.value = cur;
		const url = E('input', { 'type': 'text', 'placeholder': 'https://dns.example.com/dns-query', 'value': uci.get('roam', 'main', 'doh_url') || '' });
		const bs = E('input', { 'type': 'text', 'placeholder': '9.9.9.9,1.1.1.1', 'value': uci.get('roam', 'main', 'doh_bootstrap') || '' });
		const custom = E('div', {}, [
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'Server URL' ]), E('div', { 'class': 'cbi-value-field' }, [ url ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'Bootstrap DNS (IP addresses)' ]), E('div', { 'class': 'cbi-value-field' }, [ bs,
				E('div', { 'class': 'cbi-value-description' }, [ 'Used once to look up the server name above.' ]) ]) ])
		]);
		const sync = () => { custom.style.display = (sel.value == 'custom') ? '' : 'none'; };
		sel.addEventListener('change', sync); sync();

		const save = () => {
			const args = [ sel.value ];
			if (sel.value == 'custom') {
				if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/%-]*)?$/.test(url.value.trim()))
					return rc.note('Enter the server address as https://host/path', 'warning');
				if (!/^[0-9A-Fa-f:.]+(,[0-9A-Fa-f:.]+)*$/.test(bs.value.replace(/\s+/g, '')))
					return rc.note('Bootstrap DNS must be IP addresses separated by commas.', 'warning');
				args.push(url.value.trim(), bs.value.replace(/\s+/g, ''));
			}
			return fs.exec('/usr/libexec/roam/doh-set', args).then((r) => {
				if (r.code != 0) return rc.note('Could not change encrypted DNS: ' + (r.stderr || r.stdout || r.code), 'danger');
				window.setTimeout(() => location.reload(), 2500);
				rc.note(sel.value == 'off' ? 'Encrypted DNS is off.' : 'Encrypted DNS is on. All lookups from your devices now go to the provider over HTTPS.', 'info');
			});
		};

		return rc.card({ icon: 'lock', title: 'Encrypted DNS', off: !(on && running),
			pill: !on ? 'Off' : (running ? 'On' : 'Starting'), pillClass: !on ? '' : (running ? 'ok' : 'warn'),
			body: [
				E('p', { 'class': 'roam-muted roam-small' }, [ 'Sends every DNS lookup from this router and your devices to the chosen provider over HTTPS (DoH), so the hotel or home network cannot see or change which sites you look up. Devices that try to use their own DNS are redirected to it.' ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ 'Provider' ]), E('div', { 'class': 'cbi-value-field' }, [ sel ]) ]),
				custom,
				E('div', { 'class': 'alert-message warning' }, [ 'Hotel or airport Wi-Fi with a sign-in page: turn this off, sign in, then turn it back on. (The VPN, if on, already encrypts DNS.)' ])
			],
			actions: [ E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, save) }, [ 'Save' ]) ] });
	},

	render(data) {
		const dohCard = this.dohCard(data[1] || {});
		const m = new form.Map('network', null, null);
		let s = m.section(form.NamedSection, 'lan', 'interface', 'Router address (LAN)',
			'The address of this router on your own network. If you change it, reconnect your device and open the new address. Tip: use the arrow next to "Save & Apply" and choose "Apply unchecked" so the change is not rolled back automatically.');
		s.addremove = false;
		let o = s.option(form.Value, 'ipaddr', 'IP address');
		o.datatype = 'ip4addr("nomask")';
		o.rmempty = false;
		o = s.option(form.Value, 'netmask', 'Netmask');
		o.datatype = 'ip4addr("nomask")';
		[ '255.255.255.0', '255.255.0.0', '255.0.0.0' ].forEach((v) => o.value(v));

		const d = new form.Map('dhcp', null, null);
		s = d.section(form.NamedSection, 'lan', 'dhcp', 'Address assignment (DHCP)', 'Devices that join your network get an address from this range automatically.');
		s.addremove = false;
		o = s.option(form.Flag, 'ignore', 'Disable DHCP', 'Only for networks where another device hands out addresses.');
		o = s.option(form.Value, 'start', 'First address', 'Offset from the network address, e.g. 100 = x.x.x.100');
		o.datatype = 'uinteger';
		o.default = '100';
		o = s.option(form.Value, 'limit', 'Number of addresses');
		o.datatype = 'uinteger';
		o.default = '150';
		o = s.option(form.ListValue, 'leasetime', 'Lease time');
		[ [ '1h', '1 hour' ], [ '12h', '12 hours' ], [ '24h', '1 day' ], [ '7d', '1 week' ] ].forEach((v) => o.value(v[0], v[1]));
		o.default = '12h';

		const dohOn = (uci.get('roam', 'main', 'doh') || 'off') != 'off';
		s = d.section(form.TypedSection, 'dnsmasq', 'DNS', dohOn
			? 'Encrypted DNS is on, so lookups go to its provider. Turn it off above to choose plain DNS servers here.'
			: 'Which DNS servers your devices\' lookups are sent to.');
		s.anonymous = true;
		s.addremove = false;
		if (dohOn) {
			o = s.option(form.Flag, 'rebind_protection', 'Rebind protection', 'Blocks DNS answers that point to private addresses (protects against DNS rebinding attacks).');
			o.default = '1';
			o.rmempty = false;
			return Promise.all([ m.render(), d.render() ]).then((nodes) => E('div', {}, [
				E('p', { 'class': 'roam-intro' }, [ 'Settings for the network this router creates. Firewall, routing, VLANs and everything else are under Advanced Settings \u203a Network.' ]),
				E('div', { 'class': 'roam-grid' }, [ dohCard ])
			].concat(nodes)));
		}
		o = s.option(form.Flag, 'noresolv', 'Use my own DNS servers', 'Ignore the DNS servers offered by the upstream network (hotel/ISP) and use the ones below (unencrypted). When Encrypted DNS is on, it manages these settings and restores them when turned off.');
		o = s.option(form.DynamicList, 'server', 'DNS servers');
		o.depends('noresolv', '1');
		o.datatype = 'string';
		o.value('1.1.1.1', '1.1.1.1 (Cloudflare)');
		o.value('1.0.0.1', '1.0.0.1 (Cloudflare)');
		o.value('9.9.9.9', '9.9.9.9 (Quad9, blocks malware)');
		o.value('149.112.112.112', '149.112.112.112 (Quad9)');
		o.value('8.8.8.8', '8.8.8.8 (Google)');
		o.value('94.140.14.14', '94.140.14.14 (AdGuard, blocks ads)');
		o = s.option(form.Flag, 'rebind_protection', 'Rebind protection', 'Blocks DNS answers that point to private addresses (protects against DNS rebinding attacks). Turn off only if a captive portal or local service needs it.');
		o.default = '1';
		o.rmempty = false;

		return Promise.all([ m.render(), d.render() ]).then((nodes) => E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Settings for the network this router creates. Firewall, routing, VLANs and everything else are under Advanced Settings › Network.' ]),
			E('div', { 'class': 'roam-grid' }, [ dohCard ])
		].concat(nodes)));
	}
});
