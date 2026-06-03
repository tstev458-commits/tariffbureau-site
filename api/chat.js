module.exports = async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'Invalid request' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  // Inject today's date so the report doesn't use training cutoff
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York'
  });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2500,
        stream: false,
        system: `You are Alex Monroe, Senior Trade Analyst for The Tariff Bureau LLC. You specialize in IEEPA tariff refund recovery and CBP compliance. Be professional, concise, and authoritative. Today's date is ${today}. Always use this date in any reports or correspondence you generate. End every response with a clear next step.`,
        messages: messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Upstream API error', detail: err });
    }

    const data = await response.json();
    const reply = data?.content?.[0]?.text || '';

    return res.status(200).json({ reply });

  } catch (error) {
    return res.status(500).json({ error: error.message || 'API error — please try again.' });
  }
};
