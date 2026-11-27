'use strict';
'require baseclass';
'require fs';
'require uci';
'require roam.common as rc';

/* Apps hosted next to the router on the Roam host (Raspberry Pi OS + Docker).
   Only used when the router runs as a container (roam.main.container = 1).
   Status comes from the router itself (/usr/libexec/roam/app-status), so it works
   over HTTPS and from any client. */

const APPS = [
	{ id: 'games', icon: 'games', title: 'Games', name: 'RomM game library',
	  url: () => 'http://games.lan/', alt: (ip) => 'http://' + ip + '/',
	  text: 'Your game library. Open it on any phone, tablet or laptop connected to this router and play right in the browser (keyboard, touch, or a controller paired with that device).' },
	{ id: 'plex', icon: 'plex', title: 'Plex', name: 'Plex Media Server',
	  url: () => 'http://plex.lan:32400/web', alt: (ip) => 'http://' + ip + ':32400/web',
	  text: 'Movies, TV and music from the "media" folder. Use the Plex app or a browser on any device connected to this router.' }
];

return baseclass.extend({
	APPS: APPS,

	enabled() {
		return uci.get('roam', 'main', 'container') == '1';
	},

	hostIP() {
		return uci.get('roam', 'main', 'host_ip') || '192.168.8.2';
	},

	/* -> { host: bool, games: bool, plex: bool, setup: 'text while the host is still setting up' } */
	status() {
		return L.resolveDefault(fs.exec_direct('/usr/libexec/roam/app-status', [], 'json'), null)
			.then((s) => s || { error: true });
	},

	/* Pill text/class for one app. st == null: not checked yet. */
	pill(st, id) {
		if (!st) return [ 'Checking…', '' ];
		if (id == 'plex' && st.plex && st.plex_claimed === false) return [ 'Not linked', 'warn' ];
		if (st[id]) return [ 'Running', 'ok' ];
		if (st.setup) return [ 'Setting up', 'warn' ];
		if (st.error || !st.host) return [ 'Host offline', 'bad' ];
		return [ 'Starting / stopped', 'warn' ];
	},

	/* Compact list for the Dashboard card. */
	list(st) {
		const ip = this.hostIP();
		return E('ul', { 'class': 'roam-list' }, APPS.map((a) => {
			const p = this.pill(st, a.id);
			return E('li', {}, [
				E('span', { 'class': 'roam-ico sm' + (st && st[a.id] ? '' : ' off') }, [ rc.icon(a.icon, 16) ]),
				E('span', { 'class': 'grow' }, [
					E('strong', {}, [ a.title ]),
					E('span', { 'class': 'roam-small' }, [ E('a', { 'href': a.url(), 'target': '_blank' }, [ a.url().replace(/^http:\/\//, '').replace(/\/$/, '') ]) ]),
					E('span', { 'class': 'roam-muted roam-small' }, [ 'or ' + a.alt(ip).replace(/^http:\/\//, '') ])
				]),
				E('span', { 'class': 'roam-pill ' + p[1] }, [ p[0] ])
			]);
		}));
	},

	/* Dashboard card. */
	card(st) {
		const n = st ? APPS.filter((a) => st[a.id]).length : 0;
		return rc.card({ icon: 'games', title: 'Apps', off: !n,
			pill: !st ? 'Checking…' : (n == APPS.length ? 'All running' : (st.setup ? 'Setting up' : n + ' of ' + APPS.length + ' running')),
			pillClass: !st ? '' : (n == APPS.length ? 'ok' : 'warn'),
			body: [
				this.list(st),
				st && st.setup ? E('p', { 'class': 'roam-muted roam-small', 'style': 'margin:10px 0 0' }, [ 'First start: ' + st.setup ]) : '',
				st && st.plex && st.plex_claimed === false ? E('p', { 'class': 'roam-small', 'style': 'margin:10px 0 0' }, [
					'Plex is not linked to your Plex account yet. ', E('a', { 'href': L.url('admin/roam/apps') }, [ 'Link it on the Apps page' ]), '.' ]) : '',
				E('p', { 'class': 'roam-muted roam-small', 'style': 'margin:10px 0 0' }, [ 'Open these from any device on this router\'s Wi-Fi or Ethernet.' ])
			],
			actions: [
				E('a', { 'class': 'btn cbi-button-action', 'href': APPS[0].url(), 'target': '_blank' }, [ 'Play games' ]),
				E('a', { 'class': 'btn cbi-button', 'href': APPS[1].url(), 'target': '_blank' }, [ 'Open Plex' ]),
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/roam/apps') }, [ 'Details' ])
			] });
	}
});
