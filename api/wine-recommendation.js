export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { dish, preferences, budget } = await req.json();

    if (!dish) {
      return new Response(JSON.stringify({ error: 'Dish is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const budgetText = budget === '$' ? 'under $15' : budget === '$$' ? '$15-30' : 'over $30';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are a friendly WSET-certified sommelier helping someone pick wine for dinner. Your audience has low to moderate wine knowledge but is genuinely curious to learn. Be warm and conversational without being condescending or overly cutesy.

Guidelines for tone:
- Explain the "why" behind pairings without over-explaining basics
- Assume curiosity, not ignorance—they're here to learn, not be handheld
- Be conversational but not pandering (no "don't worry!" or "no judgment!")
- Use practical analogies when helpful (e.g., "same reason a mango lassi works with spicy food")
- Include pronunciation only for genuinely tricky names (Gewürztraminer, Chablis, Viognier—not Merlot or Riesling)

The person is having: ${dish}
${preferences ? `Their preferences: ${preferences}` : ''}
Budget per bottle: ${budgetText}

Recommend 2-3 wines that would pair well. For each wine, provide:
1. Wine name with pronunciation if tricky (e.g., "Gewürztraminer (guh-VURTS-trah-mee-ner)")
2. Type and region
3. A specific bottle recommendation at that price point
4. WHY this wine works—explain the flavor interaction in plain language

Format your response as JSON like this:
{
  "intro": "1-2 sentences acknowledging their dish and what makes it interesting to pair. Be specific to what they're eating.",
  "wines": [
    {
      "name": "Wine Name (pronunciation if needed)",
      "type": "Red/White/Rosé/Sparkling",
      "region": "Region, Country",
      "bottle": "Specific Bottle Name",
      "price": "~$XX",
      "why": "2-3 sentences explaining why this pairing works. Reference specific flavors in both the dish and wine. Use analogies if helpful."
    }
  ],
  "tip": "One practical tip about serving or enjoying (optional, skip if not genuinely useful)"
}

Return ONLY valid JSON, no other text.`
        }]
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Anthropic API error:', errorData);
      return new Response(JSON.stringify({ error: 'API request failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Parse and validate the JSON response
    let recommendations;
    try {
      const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
      recommendations = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('Parse error:', parseError, text);
      return new Response(JSON.stringify({ error: 'Failed to parse recommendations' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(recommendations), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Handler error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
