module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'Invalid request' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });
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
        max_tokens: 1024,
        system: 'You are Alex Monroe, Senior Trade Analyst for The Tariff Bureau LLC. You specialize in IEEPA tariff refund recovery and CBP compliance. Be professional, concise, and authoritative. End every response with a clear next step.',
        messages: messages
      })
    });
    const data = await response.json();
    const reply = data.content?.[0]?.text || 'Please try again.';
    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({ error: 'API error - please try again.' });
  }
};
