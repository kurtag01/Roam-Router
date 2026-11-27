'use strict';
'require view';
'require fs';
'require uci';
'require ui';
'require rpc';
'require roam.common as rc';

/* Roam updates: only from this project's signed GitHub releases (see
   /usr/libexec/roam/update). Never installs stock OpenWrt, which would remove Roam. */

const callUciCommit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ] });
const RUNNING = [ 'requested', 'downloading', 'verifying', 'installing', 'restarting' ];
const DEVICE = {
	rpi4: 'Raspberry Pi 4 (standalone router)',
	container: 'Roam host (Raspberry Pi OS + router + apps)',
	x86test: 'Test VM'
};

function run(args) {
	return L.resolveDefault(fs.exec_direct('/usr/libexec/roam/update', args, 'json'), { error: 'The router could not run the updater.' });
}

return view.extend({
	load() {
		return Promise.all([ uci.load('roam'), run([ 'cached' ]), run([ 'status' ]) ]);
	},

	render(data) {
		this.info = data[1] || {};
		this.st = data[2] || {};
		this.box = E('div', {});
		this.draw();
		if (RUNNING.indexOf(this.st.state) >= 0) this.follow();
		return E('div', {}, [
			E('p', { 'class': 'roam-intro' }, [ 'Updates come from the Roam project\'s releases: OpenWrt with all Roam features, tested on this hardware and signed. Your settings are kept.' ]),
			this.box
		]);
	},

	draw() {
		const i = this.info, st = this.st;
		const running = RUNNING.indexOf(st.state) >= 0;
		const newer = i.newer === true;
		const checked = i.checked ? new Date(i.checked * 1000).toLocaleString() : 'not yet';
		const auto = E('input', { 'type': 'checkbox', 'role': 'switch', 'checked': uci.get('roam', 'update', 'auto') != '0' ? '' : null,
			'change': (ev) => {
				uci.set('roam', 'update', 'auto', ev.target.checked ? '1' : '0');
				return uci.save().then(() => callUciCommit('roam')).catch(() => {});
			} });

		const pill = running ? [ 'Updating', 'warn' ] : i.error ? [ 'Check failed', 'bad' ] : newer ? [ 'Update available', 'warn' ]
			: i.latest ? [ 'Up to date', 'ok' ] : [ 'Not checked', '' ];

		const body = [
			rc.kv([
				[ 'Roam version', i.current || 'unknown' ],
				[ 'OpenWrt version', i.openwrt_current || null ],
				[ 'Device', DEVICE[i.target] || i.target || null ],
				[ 'Last check', checked ]
			])
		];
		if (i.error)
			body.push(E('div', { 'class': 'alert-message warning', 'style': 'margin-top:12px' }, [ i.error ]));
		else if (newer)
			body.push(E('div', { 'class': 'roam-update-new' }, [
				E('strong', {}, [ 'Roam ' + i.latest ]),
				E('span', { 'class': 'roam-muted' }, [ ' with OpenWrt ' + (i.openwrt_latest || '?') ]),
				i.notes ? E('div', {}, [ E('a', { 'href': i.notes, 'target': '_blank', 'rel': 'noopener' }, [ 'What\'s new' ]) ]) : ''
			]));
		else if (i.latest)
			body.push(E('p', { 'class': 'roam-muted roam-small', 'style': 'margin-top:12px' }, [ 'You have the newest version.' ]));

		if (st.state && st.state != 'idle')
			body.push(this.progress(st));

		body.push(E('label', { 'class': 'roam-switch', 'style': 'margin-top:18px' }, [ auto, E('span', { 'class': 'roam-switch-track', 'aria-hidden': 'true' }),
			E('span', {}, [ 'Check for updates every day' ]) ]));
		body.push(E('p', { 'class': 'roam-muted roam-small', 'style': 'margin:4px 0 0' }, [
			'Only checks; nothing is installed until you click Install. The Dashboard shows when an update is available.' ]));

		const actions = [];
		if (newer && !running)
			actions.push(E('button', { 'class': 'btn cbi-button-action', 'click': ui.createHandlerFn(this, 'install') }, [ 'Install update' ]));
		actions.push(E('button', { 'class': 'btn cbi-button' + (newer ? '' : ' cbi-button-action'), 'disabled': running ? '' : null,
			'click': ui.createHandlerFn(this, 'check') }, [ 'Check for updates' ]));

		this.box.replaceChildren(E('div', { 'class': 'roam-grid' }, [
			rc.card({ icon: 'update', title: 'Firmware', pill: pill[0], pillClass: pill[1], body: body, actions: actions }),
			rc.card({ icon: 'shield', title: 'How updates work', body: [ E('ul', { 'class': 'roam-muted roam-small', 'style': 'margin:0 0 0 18px;padding:0;list-style:disc;line-height:1.6' },
				(i.target == 'container' ? [
					'The Pi downloads the new router and apps first, while you still have Internet.',
					'It then restarts the router with the new version and your settings (Wi-Fi goes away for 1 to 2 minutes).',
					'If the new router does not come up, the Pi puts the current version back automatically.',
					'Games and Plex keep their libraries; they restart briefly if their versions change.'
				] : [
					'The router downloads the update and checks its signature and checksum before changing anything.',
					'It then writes the new firmware and restarts (about 2 minutes). Your settings are kept.',
					'Keep the router powered during the update.',
					'If something goes wrong, the SD card can always be re-flashed with the newest image from the project\'s releases page.'
				]).map((t) => E('li', {}, [ t ]))) ] })
		]));
	},

	progress(st) {
		const labels = { requested: 'Waiting for the Pi to start the update', downloading: 'Downloading', verifying: 'Checking the download',
			installing: 'Installing', restarting: 'Restarting', done: 'Updated', failed: 'Update failed', rolledback: 'Update undone' };
		const cls = st.state == 'done' ? 'notice' : (st.state == 'failed' || st.state == 'rolledback') ? 'warning' : 'info';
		return E('div', { 'class': 'alert-message ' + cls, 'style': 'margin-top:12px' }, [
			E('strong', {}, [ labels[st.state] || st.state ]), st.message ? E('div', {}, [ st.message ]) : ''
		]);
	},

	check() {
		return run([ 'check' ]).then((r) => {
			this.info = r;
			if (RUNNING.indexOf(this.st.state) < 0) this.st = { state: 'idle' };   /* old result no longer relevant */
			this.draw();
		});
	},

	install() {
		const i = this.info;
		if (!confirm('Install Roam ' + i.latest + ' now?\n\nThe router restarts and your Wi-Fi is gone for about 2 minutes. Settings are kept.'))
			return;
		return run([ 'apply' ]).then((r) => {
			if (r.error) { rc.note(r.error, 'warning'); return; }
			this.st = { state: 'downloading', message: 'Starting' };
			this.draw();
			this.follow();
		});
	},

	/* Poll the progress; while the router restarts, wait for it to answer again. */
	follow() {
		let gone = 0;
		const tick = () => {
			run([ 'status' ]).then((st) => {
				if (st.error) throw new Error(st.error);
				gone = 0;
				this.st = st; this.draw();
				if (RUNNING.indexOf(st.state) >= 0) window.setTimeout(tick, 3000);
				else if (st.state == 'done') this.restarted('The update finished.');
			}).catch(() => {
				gone++;
				this.st = { state: 'restarting', message: 'The router is restarting with the new version. This page reconnects by itself' + '.'.repeat(1 + gone % 3) };
				this.draw();
				/* Back when the sign-in page answers (sessions end with the restart). */
				fetch(L.env.cgi_base + '/luci/', { cache: 'no-store', credentials: 'same-origin' })
					.then((res) => { if (gone > 3 && (res.status == 200 || res.status == 403)) this.restarted('The router is back.'); else window.setTimeout(tick, 4000); })
					.catch(() => window.setTimeout(tick, 4000));
			});
		};
		window.setTimeout(tick, 2000);
	},

	restarted(msg) {
		this.box.replaceChildren(rc.card({ icon: 'update', title: 'Firmware', pill: 'Updated', pillClass: 'ok', body: [
			E('p', {}, [ msg + ' Sign in again to see the new version.' ]) ],
			actions: [ E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/roam/update') }, [ 'Continue' ]) ] }));
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
