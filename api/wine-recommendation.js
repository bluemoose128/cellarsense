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
          content: `You are a friendly WSET-certified wine enthusiast helping someone pick wine for dinner. Your audience has low to moderate wine knowledge but is genuinely curious to learn. Write like a knowledgeable, cool colleague, not a formal expert or an overly enthusiastic AI.

Writing style rules:
- No emdashes (use commas or periods instead)
- No phrases like "great choice!" or "lovely dish" or "beautiful canvas"
- Assume curiosity, not ignorance. They want to learn, not be handheld
- Use practical analogies when helpful (like "same reason a lassi works with spicy food")
- Keep explanations tight. Say what you need to say, then stop
- Sound like a real person texting a friend who asked for wine advice
- If multiple dishes or courses are mentioned, consider ALL of them when recommending wines

Pronunciation note: Only include pronunciation for tricky names, and put it in the "why" explanation, not the wine name. Example: "This is a Gewürztraminer (say guh-VURTS-trah-mee-ner), and it..."

The person is having: ${dish}
${preferences ? `Their preferences: ${preferences}` : ''}
Budget per bottle: ${budgetText}

Recommend 2-3 wines. For each wine:
1. Wine name (no pronunciation here)
2. Type and region
3. A specific bottle at that price point
4. WHY this wine works. Be specific about flavors. Include pronunciation here if the name is tricky.

Format as JSON:
{
  "intro": "One sentence about what makes this dish interesting to pair. No fluff.",
  "wines": [
    {
      "name": "Wine Name",
      "type": "Red/White/Rosé/Sparkling",
      "region": "Region, Country",
      "bottle": "Specific Bottle Name",
      "price": "~$XX",
      "why": "2-3 sentences on why this works. Reference specific flavors. Include pronunciation if name is tricky."
    }
  ],
  "tip": "One practical tip if genuinely useful. Otherwise omit this field entirely."
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
