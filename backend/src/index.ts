import { Hono } from 'hono';

type Env = { stopino_db: D1Database; RESEND_API_KEY: string };
const STALE_MS = 15 * 60 * 1000;

const app = new Hono<{ Bindings: Env }>();

async function sha256(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

app.post('/heartbeat', async (c) => {
	const { device_id, token, protection_active } = await c.req.json();
	if (!device_id || !token) {
		return c.json({ error: 'device_id and token required' }, 400);
	}

	const row = await c.env.stopino_db.prepare(`SELECT token_hash FROM devices WHERE id = ?`).bind(device_id).first<{ token_hash: string }>();

	if (!row || row.token_hash !== (await sha256(token))) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const now = Date.now();
	await c.env.stopino_db
		.prepare(
			`UPDATE devices
         SET last_heartbeat = ?, protection_active = ?, alerted = 0
       WHERE id = ?`
		)
		.bind(now, protection_active ? 1 : 0, device_id)
		.run();

	return c.json({ ok: true, at: now });
});

app.post('/enroll', async (context) => {
	const { device_id, platform, buddy_contact } = await context.req.json();
	if (!device_id || !platform) {
		return context.json({ error: 'device_id and platform required' }, 400);
	}
	const now = Date.now();

	//Device identifier
	const token = crypto.randomUUID() + crypto.randomUUID();
	const token_hash = await sha256(token);

	await context.env.stopino_db
		.prepare(
			`INSERT INTO devices (id, platform, token_hash, last_heartbeat, created)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET platform = excluded.platform`
		)
		.bind(device_id, platform, token_hash, now, now)
		.run();

	if (buddy_contact) {
		await context.env.stopino_db
			.prepare(`INSERT INTO buddies (id, device_id, contact) VALUES (?, ?, ?)`)
			.bind(crypto.randomUUID(), device_id, buddy_contact)
			.run();
	}

	return context.json({ ok: true, token });
});
export default {
	fetch: app.fetch,

	async scheduled(_event: ScheduledEvent, env: Env) {
		const cutoff = Date.now() - STALE_MS;

		const stale = await env.stopino_db
			.prepare(`SELECT id FROM devices WHERE last_heartbeat < ? AND alerted = 0`)
			.bind(cutoff)
			.all<{ id: string }>();

		for (const device of stale.results) {
			const buddies = await env.stopino_db
				.prepare(`SELECT contact FROM buddies WHERE device_id = ?`)
				.bind(device.id)
				.all<{ contact: string }>();

			let allSent = true;

			for (const b of buddies.results) {
				try {
					const res = await fetch('https://api.resend.com/emails', {
						method: 'POST',
						headers: {
							Authorization: `Bearer ${env.RESEND_API_KEY}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							from: 'onboarding@resend.dev',
							to: b.contact,
							subject: 'A device you support has stopped checking in',
							text:
								`The protection on a device you're supporting stopped reporting in.\n\n` +
								`This can happen if the app was turned off, removed, or the device ` +
								`has been offline for a while. It might be a good moment to check in ` +
								`with them.\n\n— Stopino`,
						}),
					});

					if (!res.ok) {
						allSent = false;
						console.error(`Resend failed for ${b.contact}: ${res.status}`);
					}
				} catch (err) {
					allSent = false;
					console.error(`Resend threw for ${b.contact}:`, err);
				}
			}

			// Only mark handled if every buddy was notified successfully
			// Retry if failed? Nah
			if (allSent) {
				await env.stopino_db.prepare(`UPDATE devices SET alerted = 1 WHERE id = ?`).bind(device.id).run();
			}
		}
	},
};
