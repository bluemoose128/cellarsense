import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const maxDuration = 60;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let browser = null;
  try {
    const data = req.body;
    const generatedContent = await generateContent(data);
    const html = buildHTML(data, generatedContent);
    
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    await browser.close();
    browser = null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${data.names.replace(/[^a-z0-9]/gi, '_')}_Wine_Guide.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF Generation Error:', error);
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
}

async function generateContent(data) {
  const prompt = `You are Anthony, a WSET-certified sommelier writing a personalized wedding wine guide.

CLIENT DETAILS:
- Names: ${data.names}
- Wedding Date: ${data.date}
- Venue: ${data.venue}
- Venue Type: ${data.venueType || 'Not specified'}
- Guest Count: ${data.guests}
- Reception Hours: ${data.hours}
- Budget: $${data.budget}
- Bar Setup: ${data.barType || 'mixed'}
- Vibe/Theme: ${data.vibe || 'Not specified'}
- Food Menu: ${data.food || 'Not specified'}
- Client Preferences: ${data.preferences || 'Not specified'}
- Special Notes: ${data.notes || 'Not specified'}

Generate JSON with:
{
  "personalLetter": "Warm 2-paragraph letter starting with 'I really enjoyed our chat...' Reference their details. ~120-150 words. End with 'Best,'",
  "wines": [
    {
      "category": "Sparkling",
      "name": "Varietal name",
      "region": "Region",
      "bottle": "Producer and wine name",
      "price": number,
      "narrative": "2-3 sentences about this selection",
      "whyPerfect": "1-2 sentences connecting to their event",
      "tastingNotes": ["note1", "note2", "note3"],
      "alternatives": [{"name": "Alt 1", "price": number}, {"name": "Alt 2", "price": number}]
    }
  ]
}
Include all 4: Sparkling, White, Red, Rosé. Never use "crafted". Respond ONLY with valid JSON.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  const result = await response.json();
  let content = result.content[0].text.trim();
  if (content.startsWith('```json')) content = content.slice(7);
  if (content.startsWith('```')) content = content.slice(3);
  if (content.endsWith('```')) content = content.slice(0, -3);
  
  try {
    return JSON.parse(content.trim());
  } catch (e) {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse AI response');
  }
}

function calculateQuantities(data) {
  const guests = parseInt(data.guests) || 100;
  const hours = parseFloat(data.hours) || 5;
  const barType = data.barType || 'mixed';
  const drinkingLevel = data.drinkingLevel || 'moderate';
  const redWhiteBalance = data.redWhiteBalance || 'balanced';
  const includeRose = data.includeRose || false;

  const wineBottlesPerGuest = { 'wine-focus': 0.50, 'wine-beer': 0.30, 'mixed': 0.20, 'toast-only': 0.05 };
  const drinkingMultiplier = { light: 0.75, moderate: 1.0, heavy: 1.25 };
  const hoursMultiplier = hours <= 3 ? 0.75 : hours <= 5 ? 1.0 : 1.15;

  let totalStillWineBottles = Math.ceil(guests * (wineBottlesPerGuest[barType] || 0.20) * (drinkingMultiplier[drinkingLevel] || 1.0) * hoursMultiplier);

  const sparklingUsage = data.sparklingUsage || 'toast-only';
  let sparklingBottles = sparklingUsage === 'toast-only' ? Math.ceil(guests / 8) :
    sparklingUsage === 'toast-and-bar' ? Math.ceil(guests / 8) + Math.ceil(guests * 0.15 / 5) : Math.ceil(guests / 15);

  let roseBottles = 0;
  if (includeRose) {
    roseBottles = Math.ceil(totalStillWineBottles * 0.20);
    totalStillWineBottles -= roseBottles;
  }

  const splits = { 'balanced': [0.5, 0.5], 'more-red': [0.6, 0.4], 'more-white': [0.4, 0.6], 'heavy-red': [0.75, 0.25], 'heavy-white': [0.25, 0.75] };
  const [redPct, whitePct] = splits[redWhiteBalance] || [0.5, 0.5];

  return {
    sparkling: sparklingBottles,
    white: Math.ceil(totalStillWineBottles * whitePct),
    red: Math.ceil(totalStillWineBottles * redPct),
    rose: roseBottles,
    total: sparklingBottles + Math.ceil(totalStillWineBottles * whitePct) + Math.ceil(totalStillWineBottles * redPct) + roseBottles
  };
}

function buildHTML(data, content) {
  const quantities = calculateQuantities(data);
  const wines = content.wines;
  
  const subtotals = {
    sparkling: quantities.sparkling * (wines.find(w => w.category === 'Sparkling')?.price || 0),
    white: quantities.white * (wines.find(w => w.category === 'White')?.price || 0),
    red: quantities.red * (wines.find(w => w.category === 'Red')?.price || 0),
    rose: quantities.rose * (wines.find(w => w.category === 'Rosé')?.price || 0)
  };
  const subtotal = Object.values(subtotals).reduce((a, b) => a + b, 0);
  const tax = Math.round(subtotal * 0.10);
  const total = subtotal + tax;

  const formattedDate = data.date ? new Date(data.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const barTypeLabels = { 'wine-focus': 'Wine-Focused', 'mixed': 'Mixed Bar', 'wine-beer': 'Wine & Beer', 'toast-only': 'Toast Only' };

  const wineCard = (wine) => !wine ? '' : `
    <div class="wine-card">
      <div class="wine-category">${wine.category}</div>
      <div class="wine-name">${wine.name}</div>
      <div class="wine-region">${wine.region}</div>
      <div class="wine-bottle">${wine.bottle} <span class="wine-price">~$${wine.price}/bottle</span></div>
      <div class="wine-narrative">${wine.narrative}</div>
      <div class="wine-perfect">
        <div class="wine-perfect-label">Why this is perfect:</div>
        <div class="wine-perfect-text">${wine.whyPerfect}</div>
      </div>
      <div class="wine-notes-label">Tasting Notes</div>
      <ul class="wine-notes-list">${wine.tastingNotes?.map(n => `<li>${n}</li>`).join('') || ''}</ul>
    </div>`;

  const altRow = (wine) => `
    <div class="alternative-row">
      <div>
        <div class="alt-category">${wine.category.toUpperCase()}</div>
        <div class="alt-original">${wine.bottle}</div>
        <div class="alt-original-price">~$${wine.price}</div>
      </div>
      <div class="alt-arrow">→</div>
      ${wine.alternatives?.map(alt => `<div><div class="alt-option">${alt.name}</div><div class="alt-option-price">~$${alt.price}</div></div>`).join('') || '<div></div><div></div>'}
    </div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    @page { size: letter; margin: 0; }
    :root { --burgundy: #722F37; --gold: #C9A962; --cream: #FAF8F5; --cream-dark: #EDE8E0; --text-dark: #2D2D2D; --text-medium: #5A5A5A; --text-light: #8A8A8A; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', sans-serif; font-size: 11pt; line-height: 1.5; color: var(--text-dark); }
    .page { width: 8.5in; height: 11in; padding: 0.6in; position: relative; page-break-after: always; background: var(--cream); }
    .page:last-child { page-break-after: avoid; }
    .cover-page { background: var(--burgundy); color: white; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
    .cover-brand { font-size: 10pt; letter-spacing: 0.2em; color: var(--gold); margin-bottom: 4pt; }
    .cover-tagline { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 10pt; color: var(--gold); margin-bottom: 80pt; }
    .cover-title { font-family: 'Cormorant Garamond', serif; font-size: 48pt; font-weight: 400; line-height: 1.1; margin-bottom: 20pt; }
    .cover-subtitle { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 16pt; margin-bottom: 30pt; }
    .cover-divider { width: 60pt; height: 1pt; background: var(--gold); margin: 0 auto 30pt; }
    .cover-details { font-size: 11pt; line-height: 1.8; }
    .cover-footer { position: absolute; bottom: 50pt; left: 0; right: 0; text-align: center; }
    .cover-footer-brand { font-size: 10pt; color: var(--gold); letter-spacing: 0.1em; }
    .cover-footer-tagline { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 9pt; color: var(--gold); margin-top: 4pt; }
    .section-title { font-family: 'Cormorant Garamond', serif; font-size: 28pt; font-weight: 600; color: var(--burgundy); text-align: center; margin-bottom: 6pt; }
    .section-subtitle { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 12pt; color: var(--text-medium); text-align: center; margin-bottom: 20pt; }
    .gold-divider { width: 50pt; height: 1pt; background: var(--gold); margin: 0 auto 25pt; }
    .toc-item { display: flex; justify-content: space-between; padding: 12pt 0; border-bottom: 1px solid var(--cream-dark); font-size: 13pt; }
    .toc-item:last-child { border-bottom: none; }
    .toc-page-num { color: var(--text-light); }
    .toc-intro { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 11pt; color: var(--text-medium); text-align: center; margin-top: 60pt; padding: 0 40pt; line-height: 1.7; }
    .letter-box { background: white; padding: 30pt; margin-bottom: 25pt; }
    .letter-greeting { font-family: 'Cormorant Garamond', serif; font-size: 16pt; font-weight: 600; color: var(--burgundy); margin-bottom: 15pt; }
    .letter-body { font-family: 'Cormorant Garamond', serif; font-size: 11pt; line-height: 1.7; color: var(--text-dark); }
    .letter-body p { margin-bottom: 12pt; }
    .letter-signature { margin-top: 20pt; }
    .letter-signature-best { font-family: 'Cormorant Garamond', serif; font-size: 11pt; color: var(--text-medium); }
    .letter-signature-name { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 14pt; color: var(--burgundy); margin-top: 30pt; }
    .event-details { display: grid; grid-template-columns: 1fr 1fr; gap: 20pt; }
    .event-detail { display: flex; align-items: flex-start; gap: 10pt; }
    .event-detail-icon { font-size: 16pt; }
    .event-detail-label { font-size: 8pt; letter-spacing: 0.1em; color: var(--text-light); text-transform: uppercase; }
    .event-detail-value { font-size: 12pt; font-weight: 600; color: var(--text-dark); }
    .wine-card { background: white; padding: 20pt; margin-bottom: 20pt; }
    .wine-category { display: inline-block; background: var(--burgundy); color: white; font-size: 8pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; padding: 4pt 10pt; margin-bottom: 12pt; }
    .wine-name { font-family: 'Cormorant Garamond', serif; font-size: 20pt; font-weight: 600; color: var(--text-dark); margin-bottom: 2pt; }
    .wine-region { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 11pt; color: var(--text-medium); margin-bottom: 8pt; }
    .wine-bottle { font-weight: 600; margin-bottom: 10pt; }
    .wine-price { color: var(--text-medium); font-weight: 400; }
    .wine-narrative { font-family: 'Cormorant Garamond', serif; font-size: 10pt; line-height: 1.6; color: var(--text-medium); margin-bottom: 12pt; }
    .wine-perfect { background: #FFFBF5; border-left: 3pt solid var(--gold); padding: 10pt 12pt; margin-bottom: 12pt; }
    .wine-perfect-label { font-size: 9pt; font-weight: 600; color: var(--burgundy); margin-bottom: 4pt; }
    .wine-perfect-text { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 9pt; color: var(--text-medium); }
    .wine-notes-label { font-size: 10pt; font-weight: 600; margin-bottom: 6pt; }
    .wine-notes-list { font-size: 9pt; color: var(--text-medium); }
    .wine-notes-list li { margin-bottom: 3pt; margin-left: 15pt; }
    .timeline-item { display: grid; grid-template-columns: 90pt 1fr; gap: 15pt; padding: 15pt 0; border-bottom: 1px solid var(--cream-dark); }
    .timeline-item:last-child { border-bottom: none; }
    .timeline-time { font-size: 10pt; font-weight: 600; color: var(--burgundy); }
    .timeline-title { font-weight: 600; margin-bottom: 4pt; }
    .timeline-desc { font-size: 9pt; color: var(--text-medium); line-height: 1.5; }
    .retailers-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; margin-bottom: 25pt; }
    .retailer-card { background: white; padding: 12pt; }
    .retailer-name { font-weight: 600; margin-bottom: 2pt; }
    .retailer-url { font-size: 9pt; color: var(--burgundy); margin-bottom: 4pt; }
    .retailer-note { font-size: 8pt; color: var(--text-light); }
    .alternatives-title { font-size: 12pt; font-weight: 600; color: var(--burgundy); margin-bottom: 12pt; }
    .alternative-row { background: white; padding: 12pt; margin-bottom: 10pt; display: grid; grid-template-columns: 1fr auto 1fr 1fr; align-items: center; gap: 10pt; }
    .alt-category { font-size: 8pt; font-weight: 600; color: var(--burgundy); letter-spacing: 0.05em; }
    .alt-original { font-size: 10pt; }
    .alt-original-price { font-size: 9pt; color: var(--text-light); }
    .alt-arrow { color: var(--text-light); font-size: 14pt; }
    .alt-option { font-size: 9pt; }
    .alt-option-price { font-size: 8pt; color: var(--text-light); }
    .quantity-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10pt; margin-bottom: 30pt; }
    .quantity-box { background: white; padding: 15pt 10pt; text-align: center; }
    .quantity-box.total { background: var(--burgundy); color: white; }
    .quantity-label { font-size: 8pt; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-light); margin-bottom: 5pt; }
    .quantity-box.total .quantity-label { color: rgba(255,255,255,0.7); }
    .quantity-value { font-size: 24pt; font-weight: 700; color: var(--burgundy); }
    .quantity-box.total .quantity-value { color: white; }
    .budget-section { display: grid; grid-template-columns: 1fr 1fr; gap: 30pt; }
    .budget-table { background: white; padding: 20pt; }
    .budget-row { display: flex; justify-content: space-between; padding: 8pt 0; border-bottom: 1px solid var(--cream-dark); }
    .budget-row:last-child { border-bottom: none; }
    .budget-row.subtotal { font-weight: 600; border-top: 1px solid var(--cream-dark); margin-top: 5pt; padding-top: 12pt; }
    .budget-row.tax { font-size: 9pt; font-style: italic; color: var(--text-medium); }
    .budget-row.total { background: var(--burgundy); color: white; margin: 10pt -20pt -20pt; padding: 12pt 20pt; font-weight: 600; }
    .pro-tips { margin-top: 25pt; }
    .pro-tips-title { font-size: 12pt; font-weight: 600; color: var(--burgundy); margin-bottom: 12pt; }
    .pro-tip { font-size: 9pt; color: var(--text-medium); margin-bottom: 8pt; padding-left: 15pt; position: relative; }
    .pro-tip::before { content: "✓"; position: absolute; left: 0; color: var(--gold); }
    .page-footer { position: absolute; bottom: 30pt; left: 0; right: 0; text-align: center; }
    .page-number { font-size: 9pt; color: var(--text-light); }
    .final-footer { text-align: center; margin-top: 40pt; padding-top: 20pt; border-top: 1px solid var(--cream-dark); }
    .final-footer-brand { font-size: 10pt; letter-spacing: 0.15em; color: var(--burgundy); }
    .final-footer-tagline { font-size: 8pt; color: var(--text-light); margin-top: 4pt; }
    .final-footer-contact { font-size: 8pt; color: var(--text-medium); margin-top: 4pt; }
  </style>
</head>
<body>
<div class="page cover-page">
  <div class="cover-brand">CellarSense.ai</div>
  <div class="cover-tagline">Designed by a WSET-Certified Sommelier</div>
  <div class="cover-title">Your Wedding<br>Wine Guide</div>
  <div class="cover-subtitle">Prepared exclusively for ${data.names}</div>
  <div class="cover-divider"></div>
  <div class="cover-details">${formattedDate ? `${formattedDate}<br>` : ''}${data.venue || ''}</div>
  <div class="cover-footer"><div class="cover-footer-brand">CellarSense.ai</div><div class="cover-footer-tagline">Designed by a WSET-Certified Sommelier</div></div>
</div>

<div class="page">
  <div class="section-title">What's Inside</div>
  <div class="gold-divider"></div>
  <div style="max-width: 400pt; margin: 0 auto;">
    <div class="toc-item"><span>Your Wine Vision</span><span class="toc-page-num">3</span></div>
    <div class="toc-item"><span>Our Selections for You</span><span class="toc-page-num">4–5</span></div>
    <div class="toc-item"><span>Day-of Timeline</span><span class="toc-page-num">6</span></div>
    <div class="toc-item"><span>Where to Buy & Alternatives</span><span class="toc-page-num">7</span></div>
    <div class="toc-item"><span>Quantities & Budget</span><span class="toc-page-num">8</span></div>
  </div>
  <div class="toc-intro">This guide was created specifically for your celebration, taking into account your venue, guest count, personal preferences, and vision for the day.</div>
  <div class="page-footer"><span class="page-number">2</span></div>
</div>

<div class="page">
  <div class="section-title">Your Wine Vision</div>
  <div class="section-subtitle">Understanding Your Celebration</div>
  <div class="gold-divider"></div>
  <div class="letter-box">
    <div class="letter-greeting">${data.names} —</div>
    <div class="letter-body">${content.personalLetter.split('\n\n').map(p => `<p>${p}</p>`).join('')}</div>
    <div class="letter-signature"><div class="letter-signature-best">Best,</div><div class="letter-signature-name">Anthony</div></div>
  </div>
  <div class="event-details">
    <div class="event-detail"><span class="event-detail-icon">👥</span><div><div class="event-detail-label">Guest Count</div><div class="event-detail-value">${data.guests} Guests</div></div></div>
    <div class="event-detail"><span class="event-detail-icon">🕐</span><div><div class="event-detail-label">Reception</div><div class="event-detail-value">${data.hours} Hours</div></div></div>
    <div class="event-detail"><span class="event-detail-icon">🍷</span><div><div class="event-detail-label">Bar Style</div><div class="event-detail-value">${barTypeLabels[data.barType] || 'Mixed Bar'}</div></div></div>
    <div class="event-detail"><span class="event-detail-icon">📍</span><div><div class="event-detail-label">Venue</div><div class="event-detail-value">${data.venueType || data.venue || 'Venue'}</div></div></div>
  </div>
  <div class="page-footer"><span class="page-number">3</span></div>
</div>

<div class="page">
  <div class="section-title">Our Selections for You</div>
  <div class="section-subtitle">Thoughtfully chosen to complement your celebration</div>
  <div class="gold-divider"></div>
  ${wineCard(wines.find(w => w.category === 'Sparkling'))}
  ${wineCard(wines.find(w => w.category === 'White'))}
  <div class="page-footer"><span class="page-number">4</span></div>
</div>

<div class="page">
  <div class="section-title">Our Selections for You</div>
  <div class="section-subtitle">Continued</div>
  <div class="gold-divider"></div>
  ${wineCard(wines.find(w => w.category === 'Red'))}
  ${wineCard(wines.find(w => w.category === 'Rosé'))}
  <div class="page-footer"><span class="page-number">5</span></div>
</div>

<div class="page">
  <div class="section-title">Day-of Timeline</div>
  <div class="section-subtitle">A sommelier's guide to wine service</div>
  <div class="gold-divider"></div>
  <div class="timeline-item"><div class="timeline-time">3–4 hours before</div><div><div class="timeline-title">Chill the whites and rosé</div><div class="timeline-desc">Place white wine and rosé in refrigeration. Aim for 45-50°F.</div></div></div>
  <div class="timeline-item"><div class="timeline-time">2–3 hours before</div><div><div class="timeline-title">Chill the sparkling wine</div><div class="timeline-desc">Champagne should be well-chilled to 40-45°F.</div></div></div>
  <div class="timeline-item"><div class="timeline-time">1 hour before</div><div><div class="timeline-title">Set out the red wine</div><div class="timeline-desc">Red wine should be served at "cellar temperature" (60-65°F).</div></div></div>
  <div class="timeline-item"><div class="timeline-time">30 min before</div><div><div class="timeline-title">Open red wines to breathe</div><div class="timeline-desc">Open 2-3 bottles of red wine to let them breathe.</div></div></div>
  <div class="timeline-item"><div class="timeline-time">Toast time</div><div><div class="timeline-title">Pour sparkling for the toast</div><div class="timeline-desc">Fill flutes two-thirds full. Pour slowly down the side.</div></div></div>
  <div class="timeline-item"><div class="timeline-time">During dinner</div><div><div class="timeline-title">Keep wines at temperature</div><div class="timeline-desc">Rotate white and rosé between ice buckets and service.</div></div></div>
  <div class="page-footer"><span class="page-number">6</span></div>
</div>

<div class="page">
  <div class="section-title">Where to Buy</div>
  <div class="section-subtitle">Plus alternatives if your first choice isn't available</div>
  <div class="gold-divider"></div>
  <div style="font-size: 11pt; font-weight: 600; color: var(--burgundy); margin-bottom: 10pt;">Online Retailers</div>
  <div class="retailers-grid">
    <div class="retailer-card"><div class="retailer-name">Wine.com</div><div class="retailer-url">wine.com</div><div class="retailer-note">Wide selection, reliable shipping.</div></div>
    <div class="retailer-card"><div class="retailer-name">Total Wine & More</div><div class="retailer-url">totalwine.com</div><div class="retailer-note">Great prices, in-store pickup.</div></div>
    <div class="retailer-card"><div class="retailer-name">Vivino</div><div class="retailer-url">vivino.com</div><div class="retailer-note">Compare prices across retailers.</div></div>
    <div class="retailer-card"><div class="retailer-name">K&L Wine Merchants</div><div class="retailer-url">klwines.com</div><div class="retailer-note">Excellent for premium wines.</div></div>
  </div>
  <div class="alternatives-title">If You Can't Find Our First Choice</div>
  ${wines.map(altRow).join('')}
  <div class="page-footer"><span class="page-number">7</span></div>
</div>

<div class="page">
  <div class="section-title">Quantities & Budget</div>
  <div class="section-subtitle">Everything you need to bring this vision to life</div>
  <div class="gold-divider"></div>
  <div style="font-size: 11pt; font-weight: 600; color: var(--burgundy); margin-bottom: 10pt;">Recommended Quantities</div>
  <div class="quantity-grid">
    <div class="quantity-box"><div class="quantity-label">Sparkling</div><div class="quantity-value">${quantities.sparkling}</div></div>
    <div class="quantity-box"><div class="quantity-label">White</div><div class="quantity-value">${quantities.white}</div></div>
    <div class="quantity-box"><div class="quantity-label">Red</div><div class="quantity-value">${quantities.red}</div></div>
    <div class="quantity-box"><div class="quantity-label">Rosé</div><div class="quantity-value">${quantities.rose}</div></div>
    <div class="quantity-box total"><div class="quantity-label">Total</div><div class="quantity-value">${quantities.total}</div></div>
  </div>
  <div class="budget-section">
    <div>
      <div style="font-size: 11pt; font-weight: 600; color: var(--burgundy); margin-bottom: 10pt;">Event Budget</div>
      <div class="budget-table">
        <div class="budget-row"><span>Sparkling (${quantities.sparkling} × $${wines.find(w => w.category === 'Sparkling')?.price || 0})</span><span>$${subtotals.sparkling}</span></div>
        <div class="budget-row"><span>White (${quantities.white} × $${wines.find(w => w.category === 'White')?.price || 0})</span><span>$${subtotals.white}</span></div>
        <div class="budget-row"><span>Red (${quantities.red} × $${wines.find(w => w.category === 'Red')?.price || 0})</span><span>$${subtotals.red}</span></div>
        <div class="budget-row"><span>Rosé (${quantities.rose} × $${wines.find(w => w.category === 'Rosé')?.price || 0})</span><span>$${subtotals.rose}</span></div>
        <div class="budget-row subtotal"><span>Subtotal</span><span>$${subtotal}</span></div>
        <div class="budget-row tax"><span>Sales Tax (est. 10%)</span><span>$${tax}</span></div>
        <div class="budget-row total"><span>Estimated Total</span><span>$${total}</span></div>
      </div>
    </div>
    <div class="pro-tips">
      <div class="pro-tips-title">Pro Tips</div>
      <div class="pro-tip">Order 10-15% extra. Most retailers accept returns on unopened bottles.</div>
      <div class="pro-tip">Ask about case discounts when ordering 12+ bottles.</div>
      <div class="pro-tip">Plan for one bottle opener per 50 guests.</div>
      <div class="pro-tip">Order wines 2-3 weeks ahead to ensure availability.</div>
    </div>
  </div>
  <div class="final-footer">
    <div class="final-footer-brand">C E L L A R S E N S E</div>
    <div class="final-footer-tagline">WSET-Certified Sommelier Consultation</div>
    <div class="final-footer-contact">Questions? hello@cellarsense.ai</div>
  </div>
  <div class="page-footer"><span class="page-number">8</span></div>
</div>
</body>
</html>`;
}
