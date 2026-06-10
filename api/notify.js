// api/notify.js
// Receives TariffIQ Smart Intake submission data
// Sends email notification to terrence@tariffbureau.com via Resend API
// Free tier: 3,000 emails/month, no credit card required
// Setup: add RESEND_API_KEY to Vercel env vars (resend.com/signup)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const d = req.body;
    if (!d || !d.company) return res.status(400).json({ error: 'No data' });

    // If no RESEND_API_KEY yet, just log and return success
    // so the wizard doesn't break — set up key later
    if (!process.env.RESEND_API_KEY) {
      console.log('[NOTIFY_NO_KEY] Lead received:', JSON.stringify(d, null, 2));
      return res.status(200).json({ ok: true, note: 'logged only — set RESEND_API_KEY' });
    }

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#f8f4ee;padding:32px;border-radius:8px;">
        <div style="background:#0b1829;padding:20px 24px;border-radius:6px 6px 0 0;margin-bottom:0;">
          <h2 style="color:#c9a84c;font-size:18px;margin:0;">&#128680; New TariffIQ Screening Submission</h2>
          <p style="color:#8fa4bc;font-size:12px;margin:6px 0 0;">The Tariff Bureau &bull; TariffIQ&trade; Smart Intake</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e0d9ce;border-radius:0 0 6px 6px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:#666;width:140px;"><strong>Company</strong></td><td style="padding:8px 0;color:#111;">${d.company || '—'}</td></tr>
            <tr style="background:#f9f7f4;"><td style="padding:8px 4px;color:#666;"><strong>Contact</strong></td><td style="padding:8px 4px;color:#111;">${d.contact || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>Email</strong></td><td style="padding:8px 0;"><a href="mailto:${d.email}" style="color:#c9a84c;">${d.email || '—'}</a></td></tr>
            <tr style="background:#f9f7f4;"><td style="padding:8px 4px;color:#666;"><strong>Phone</strong></td><td style="padding:8px 4px;color:#111;">${d.phone || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>Country</strong></td><td style="padding:8px 0;color:#111;">${d.country || '—'}</td></tr>
            <tr style="background:#f9f7f4;"><td style="padding:8px 4px;color:#666;"><strong>Entity Type</strong></td><td style="padding:8px 4px;color:#111;">${d.entityType || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>Importer Type</strong></td><td style="padding:8px 0;color:#111;">${d.importerType || '—'}</td></tr>
            <tr style="background:#f9f7f4;"><td style="padding:8px 4px;color:#666;"><strong>Total Duty Est.</strong></td><td style="padding:8px 4px;color:#111;font-weight:bold;">$${parseFloat(d.totalDuty||0).toLocaleString()}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>Broker</strong></td><td style="padding:8px 0;color:#111;">${d.brokerName || 'None'}</td></tr>
            <tr style="background:#f9f7f4;"><td style="padding:8px 4px;color:#666;"><strong>ACE Active</strong></td><td style="padding:8px 4px;color:#111;">${d.hasAce || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#666;"><strong>ACH Enrolled</strong></td><td style="padding:8px 0;color:#111;">${d.hasAch || '—'}</td></tr>
            <tr style="background:#f9f7f4;"><td style="padding:8px 4px;color:#666;"><strong>Prior Disclosures</strong></td><td style="padding:8px 4px;color:#111;">${d.priorDisclosures || '—'}</td></tr>
          </table>
          ${d.entries ? `<div style="margin-top:16px;padding:12px;background:#f0ede8;border-radius:4px;font-size:12px;color:#555;"><strong>Entries:</strong><br/><pre style="margin:6px 0 0;font-size:11px;">${d.entries}</pre></div>` : ''}
          <div style="margin-top:20px;padding:14px;background:#0b1829;border-radius:6px;text-align:center;">
            <a href="mailto:${d.email}?subject=Re: Your TariffIQ IEEPA Eligibility Assessment — ${encodeURIComponent(d.company||'')}" style="background:#c9a84c;color:#0b1829;padding:10px 24px;border-radius:4px;font-weight:700;font-size:14px;text-decoration:none;">Reply to ${d.contact || 'Lead'}</a>
          </div>
          <p style="margin-top:16px;font-size:11px;color:#999;text-align:center;">Submitted: ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET &bull; TariffIQ Smart Intake &bull; tariffbureau.com</p>
        </div>
      </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'TariffIQ Intake <onboarding@resend.dev>',
        to: ['terrence@tariffbureau.com'],
        subject: `New TariffIQ Screening — ${d.company || 'Unknown'} ($${parseFloat(d.totalDuty||0).toLocaleString()})`,
        html
      })
    });

    const result = await response.json();
    console.log('[NOTIFY_SENT]', JSON.stringify(result));
    return res.status(200).json({ ok: true, id: result.id });

  } catch (err) {
    console.error('[NOTIFY_ERROR]', err.message);
    return res.status(500).json({ error: 'Notify failed', message: err.message });
  }
};
